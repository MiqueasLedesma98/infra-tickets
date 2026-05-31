# Ticket Infrastructure Management System (IaC) 🚀

Este repositorio contiene la arquitectura de infraestructura como código (IaC) para el sistema de gestión y procesamiento de tickets. Está desarrollado utilizando **AWS CDK (Cloud Development Kit)** con **TypeScript**, estructurado bajo un enfoque *Serverless-First* orientado a eventos y optimización de costos.

---

## 🏗️ Arquitectura del Sistema

La infraestructura implementa un patrón desacoplado (**Pub/Sub + Fan-out**) para garantizar alta disponibilidad, tolerancia a fallos y escalabilidad lineal:

* **Capa de Entrada (API REST):** Servicio administrado en **AWS Fargate (ECS)** que expone los endpoints para la gestión de tickets.
* **Capa de Datos:** **Amazon DynamoDB** configurado en modo *On-Demand (Pay-per-request)* utilizando un diseño de tabla única (*Single Table Design*) para optimizar lecturas e indexación, junto a **Amazon S3** con versionamiento para almacenamiento de archivos adjuntos.
* **Capa de Mensajería (Desacoplamiento asíncrono):** La API publica eventos en **Amazon SNS**. El microservicio Worker procesa de forma asíncrona estos eventos consumiendo mensajes desde una cola de **Amazon SQS** dedicada, aislando fallos de procesamiento y evitando la pérdida de información.
* **Capa de Procesamiento (Worker):** Servicio en **AWS Fargate (ECS)** que consume de SQS para tareas pesadas (notificaciones, auditorías, procesamiento de archivos).

Tanto la API como el Worker conviven de manera eficiente dentro de una misma **Amazon VPC** y un único **ECS Cluster** lógico, mitigando costos innecesarios de red (como múltiples NAT Gateways).

---

## 🛠️ Stack Tecnológico

* **Lenguaje:** TypeScript
* **IaC:** AWS CDK v2
* **Mensajería:** Amazon SNS & Amazon SQS (Pattern Fan-out)
* **Compute:** AWS Fargate (ECS)
* **Database & Storage:** Amazon DynamoDB & Amazon S3
* **Testing:** Jest & AWS CDK Assertions Module
* **CI/CD:** GitHub Actions

---

## 🧪 Estrategia de Testing

Para garantizar la estabilidad de la topología de red y los permisos de seguridad (IAM), el proyecto incluye pruebas unitarias automatizadas con Jest:

1.  **Fine-Grained Assertions:** Validaciones específicas sobre las propiedades de los recursos (ej. asegurar que el `VisibilityTimeout` de SQS sea el adecuado, verificar claves en DynamoDB o el versionamiento en S3).
2.  **Snapshot Testing:** Pruebas de captura globales que protegen el estado de la infraestructura contra cambios imprevistos o regresiones accidentales en los Pull Requests.

Para ejecutar las pruebas localmente:
```bash
npm run test