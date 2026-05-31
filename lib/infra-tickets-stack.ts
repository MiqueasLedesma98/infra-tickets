import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";

export class InfraTicketsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. CAPA DE MENSAJERÍA (Desacoplamiento asíncrono)
    // ==========================================
    const snsTopic = new sns.Topic(this, "InfraTicketsTopic", {
      displayName: "Infra Tickets Notifications",
    });

    // Cola dedicada para el Worker de notificaciones
    const workerQueue = new sqs.Queue(this, "InfraTicketsWorkerQueue", {
      visibilityTimeout: cdk.Duration.seconds(300), // Recomendado: 5 veces el timeout de tu app
    });

    // Suscribir la cola SQS al tópico SNS (Patrón Pub/Sub)
    snsTopic.addSubscription(new subs.SqsSubscription(workerQueue));

    // ==========================================
    // 2. CAPA DE ALMACENAMIENTO Y DATOS
    // ==========================================
    const bucket = new s3.Bucket(this, "InfraTicketsBucket", {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const table = new dynamodb.Table(this, "InfraTicketsTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING }, // Clave compuesta para Single Table Design
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==========================================
    // 3. CAPA DE RED Y PROCESAMIENTO (Una sola VPC y Clúster)
    // ==========================================
    const vpc = new ec2.Vpc(this, "InfraTicketsVPC", {
      maxAzs: 2,
      // Opcional para ahorrar costos local/pruebas si no despliegas: natGateways: 1
    });

    const cluster = new ecs.Cluster(this, "InfraTicketsCluster", { vpc });

    // ==========================================
    // 4. MICROSERVICIO: API REST (Tickets)
    // ==========================================
    const taskDefinitionApi = new ecs.FargateTaskDefinition(
      this,
      "InfraTicketsApiTaskDef",
      {
        memoryLimitMiB: 512,
        cpu: 256,
      },
    );

    const containerApi = taskDefinitionApi.addContainer(
      "InfraTicketsApiContainer",
      {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"), // Cambiar por tu imagen de NestJS luego
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: "InfraTicketsApi" }),
      },
    );

    containerApi.addEnvironment("BUCKET_NAME", bucket.bucketName);
    containerApi.addEnvironment("TABLE_NAME", table.tableName);
    containerApi.addEnvironment("SNS_TOPIC_ARN", snsTopic.topicArn); // La API necesita saber dónde publicar

    // Permisos para la API
    bucket.grantReadWrite(taskDefinitionApi.taskRole);
    table.grantReadWriteData(taskDefinitionApi.taskRole);
    snsTopic.grantPublish(taskDefinitionApi.taskRole); // Permiso para publicar eventos

    new ecs.FargateService(this, "InfraTicketsApiService", {
      cluster,
      taskDefinition: taskDefinitionApi,
      desiredCount: 1,
    });

    // ==========================================
    // 5. MICROSERVICIO: WORKER (Notificaciones / Colas)
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
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"), // Cambiar por tu imagen del Worker luego
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: "InfraTicketsWorker" }),
      },
    );

    containerWorker.addEnvironment("BUCKET_NAME", bucket.bucketName);
    containerWorker.addEnvironment("TABLE_NAME", table.tableName);
    containerWorker.addEnvironment("SQS_QUEUE_URL", workerQueue.queueUrl); // El worker necesita saber qué cola escuchar

    // Permisos para el Worker
    bucket.grantReadWrite(taskDefinitionWorker.taskRole);
    table.grantReadWriteData(taskDefinitionWorker.taskRole);
    workerQueue.grantConsumeMessages(taskDefinitionWorker.taskRole); // Permiso para leer/borrar de la cola

    new ecs.FargateService(this, "InfraTicketsWorkerService", {
      cluster,
      taskDefinition: taskDefinitionWorker,
      desiredCount: 1,
    });
  }
}
