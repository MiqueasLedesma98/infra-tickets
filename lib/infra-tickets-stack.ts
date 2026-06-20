import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as rds from "aws-cdk-lib/aws-rds";

export class InfraTicketsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. CAPA DE RED (VPC y Clúster)
    // ==========================================
    const vpc = new ec2.Vpc(this, "InfraTicketsVPC", {
      maxAzs: 2,
      // natGateways: 1 // Descomenta esto en entornos reales para ahorrar costos si usas subredes privadas
    });

    const cluster = new ecs.Cluster(this, "InfraTicketsCluster", { vpc });

    // ==========================================
    // 2. CAPA DE MENSAJERÍA (Pub/Sub)
    // ==========================================
    const snsTopic = new sns.Topic(this, "InfraTicketsTopic", {
      displayName: "Infra Tickets Notifications",
    });

    const workerQueue = new sqs.Queue(this, "InfraTicketsWorkerQueue", {
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    snsTopic.addSubscription(new subs.SqsSubscription(workerQueue));

    // ==========================================
    // 3. CAPA DE ALMACENAMIENTO Y DATOS
    // ==========================================
    const bucket = new s3.Bucket(this, "InfraTicketsBucket", {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Base de datos NoSQL para el Microservicio de Notificaciones
    const notificationsTable = new dynamodb.Table(this, "NotificationsTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // NUEVO: Base de datos PostgreSQL para la API de NestJS
    const postgresEngine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_15,
    });

    const dbPostgres = new rds.DatabaseInstance(this, "InfraTicketsPostgres", {
      engine: postgresEngine,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Seguridad: Base de datos aislada de internet
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO,
      ), // Económica para desarrollo
      databaseName: "ticket_db",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      allocatedStorage: 20,
    });

    // ==========================================
    // 4. MICROSERVICIO: API REST (NestJS) + LOAD BALANCER
    // ==========================================

    // Usamos ecs_patterns para levantar automáticamente el ALB junto con Fargate
    const apiService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "InfraTicketsApiService",
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        publicLoadBalancer: true, // Expone el balanceador a internet
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"), // Cambiar por tu imagen
          containerPort: 3000, // Puerto por defecto donde corre NestJS
          environment: {
            BUCKET_NAME: bucket.bucketName,
            SNS_TOPIC_ARN: snsTopic.topicArn,
            DB_HOST: dbPostgres.dbInstanceEndpointAddress,
            DB_PORT: dbPostgres.dbInstanceEndpointPort,
            // Nota: Las credenciales secretas de la DB se manejan mejor inyectando dbPostgres.secret
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "InfraTicketsApi",
          }),
        },
      },
    );

    // Permisos específicos de la API
    bucket.grantReadWrite(apiService.taskDefinition.taskRole);
    snsTopic.grantPublish(apiService.taskDefinition.taskRole);

    // Permitir que la API se conecte a la base de datos en el puerto 5432
    dbPostgres.connections.allowDefaultPortFrom(apiService.service.connections);

    // ==========================================
    // 5. MICROSERVICIO: WORKER (Notificaciones)
    // ==========================================
    const taskDefinitionWorker = new ecs.FargateTaskDefinition(
      this,
      "InfraTicketsWorkerTaskDef",
      {
        memoryLimitMiB: 512,
        cpu: 256,
      },
    );

    const containerWorker = taskDefinitionWorker.addContainer(
      "InfraTicketsWorkerContainer",
      {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"), // Cambiar por tu imagen del Worker
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: "InfraTicketsWorker" }),
      },
    );

    containerWorker.addEnvironment("TABLE_NAME", notificationsTable.tableName);
    containerWorker.addEnvironment("SQS_QUEUE_URL", workerQueue.queueUrl);

    // Permisos específicos del Worker (No accede a Postgres, sí a Dynamo y SQS)
    notificationsTable.grantReadWriteData(taskDefinitionWorker.taskRole);
    workerQueue.grantConsumeMessages(taskDefinitionWorker.taskRole);

    new ecs.FargateService(this, "InfraTicketsWorkerService", {
      cluster,
      taskDefinition: taskDefinitionWorker,
      desiredCount: 1,
    });
  }
}
