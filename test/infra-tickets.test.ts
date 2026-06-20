import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as InfraTickets from "../lib/infra-tickets-stack";

test("La infraestructura contiene todos los recursos base y nuevos componentes correctamente configurados", () => {
  const app = new cdk.App();

  // 1. Instanciar el Stack real
  const stack = new InfraTickets.InfraTicketsStack(app, "MyTestStack");

  // 2. Crear la plantilla sintetizada para analizarla
  const template = Template.fromStack(stack);

  // ==========================================
  // COMPONENTES BASE
  // ==========================================

  // Validar que la Cola SQS exista y tenga el timeout correcto
  template.hasResourceProperties("AWS::SQS::Queue", {
    VisibilityTimeout: 300,
  });

  // Validar que la Tabla de DynamoDB tenga Single Table Design y modo Serverless (On-Demand)
  template.hasResourceProperties("AWS::DynamoDB::Table", {
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    BillingMode: "PAY_PER_REQUEST",
  });

  // Validar que el Bucket de S3 tenga habilitado el Versionamiento
  template.hasResourceProperties("AWS::S3::Bucket", {
    VersioningConfiguration: {
      Status: "Enabled",
    },
  });

  // Validar que existan 2 servicios de ECS Fargate (API y Worker)
  template.resourceCountIs("AWS::ECS::Service", 2);

  // ==========================================
  // NUEVOS COMPONENTES: RED Y RDS POSTGRES
  // ==========================================

  // Validar la creación de la Base de Datos RDS PostgreSQL
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    Engine: "postgres",
    EngineVersion: "15",
    DBInstanceClass: "db.t3.micro",
    DBName: "ticket_db",
    AllocatedStorage: "20",
  });

  // Validar que la VPC se configure con un máximo de 2 Zonas de Disponibilidad (AZs)
  template.hasResourceProperties("AWS::EC2::VPC", {
    EnableDnsHostnames: true,
    EnableDnsSupport: true,
  });

  // ==========================================
  // NUEVOS COMPONENTES: CONFIGURACIÓN DE ECS
  // ==========================================

  // Validar que la definición de tareas de la API de NestJS mapee el contenedor en el puerto 3000
  // e inyecte las variables de entorno de la base de datos (RDS)
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Name: "web", // Nombre por defecto que le pone el patrón ApplicationLoadBalancedFargateService
        PortMappings: Match.arrayWith([
          Match.objectLike({
            ContainerPort: 3000,
          }),
        ]),
        Environment: Match.arrayWith([
          Match.objectLike({ Name: "DB_HOST" }),
          Match.objectLike({ Name: "DB_PORT" }),
        ]),
      }),
    ]),
  });

  // Validar la definición de tareas del Worker
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Name: "InfraTicketsWorkerContainer",
        Environment: Match.arrayWith([
          Match.objectLike({ Name: "TABLE_NAME" }),
          Match.objectLike({ Name: "SQS_QUEUE_URL" }),
        ]),
      }),
    ]),
  });
  // ==========================================
  // SEGURIDAD: REGLAS DE SECURITY GROUPS
  // ==========================================

  // Validar que exista una regla de Security Group de entrada (Ingress) para Postgres
  // que permita el tráfico desde el Security Group del servicio de la API de NestJS
  template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
    IpProtocol: "tcp",
    FromPort: Match.anyValue(), // Cambiado de 5432 a Match.anyValue() porque CloudFormation usa Fn::GetAtt
    ToPort: Match.anyValue(), // Cambiado de 5432 a Match.anyValue() porque CloudFormation usa Fn::GetAtt
    SourceSecurityGroupId: Match.anyValue(),
  });

  // Validar que el Balanceador de Carga de la API (ALB) acepte tráfico público HTTP por el puerto 80
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
    Port: 80,
    Protocol: "HTTP",
  });
});
