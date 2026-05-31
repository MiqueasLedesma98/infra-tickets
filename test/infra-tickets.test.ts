import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as InfraTickets from '../lib/infra-tickets-stack';

test('La infraestructura base contiene los recursos clave correctamente configurados', () => {
  const app = new cdk.App();
  
  // 1. INSTANCIAR el Stack real
  const stack = new InfraTickets.InfraTicketsStack(app, 'MyTestStack');
  
  // 2. CREAR la plantilla sintetizada para analizarla
  const template = Template.fromStack(stack);

  // 3. SECCIÓN DE PRUEBAS (THEN)

  // Validar que la Cola SQS exista y tenga el timeout correcto
  template.hasResourceProperties('AWS::SQS::Queue', {
    VisibilityTimeout: 300
  });

  // Validar que la Tabla de DynamoDB tenga Single Table Design y modo Serverless (On-Demand)
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  });

  // Validar que el Bucket de S3 tenga habilitado el Versionamiento
  template.hasResourceProperties('AWS::S3::Bucket', {
    VersioningConfiguration: {
      Status: 'Enabled'
    }
  });

  // Validar que existan 2 servicios de ECS Fargate (API y Worker)
  template.resourceCountIs('AWS::ECS::Service', 2);
});