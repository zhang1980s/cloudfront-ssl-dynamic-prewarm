import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

export class CloudfrontDynamicAPIStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = 'eu-central-1.cloudfrontlab.zzhe.xyz';
    const nlbDomainName = `nlb.${domainName}`;

 // VPC for ECS cluster
 const vpc = new ec2.Vpc(this, 'LabVpc', {
  maxAzs: 3,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
    {
      cidrMask: 24,
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
    }
  ],
});

// ECS Cluster
const cluster = new ecs.Cluster(this, 'LabCluster', {
  vpc,
});

// ECR Repository (Assuming it's already created)
const repository = ecr.Repository.fromRepositoryName(this, 'Repository', 'current-time-app');

// Fargate Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
  memoryLimitMiB: 512,
  cpu: 256,
  runtimePlatform: {
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    cpuArchitecture: ecs.CpuArchitecture.ARM64,
  },
});

const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
  vpc,
  allowAllOutbound: true,
  description: 'Security group for ECS tasks',
});

ecsSecurityGroup.addIngressRule(
  ec2.Peer.ipv4(vpc.vpcCidrBlock),
  ec2.Port.tcp(8080),
  'Allow inbound traffic from NLB'
);

taskDefinition.addContainer('CurrentTimeAppContainer', {
  image: ecs.ContainerImage.fromEcrRepository(repository),
  portMappings: [{ containerPort: 8080 }],
});

// Fargate Service
const fargateService = new ecs.FargateService(this, 'FargateService', {
  cluster,
  taskDefinition,
  desiredCount: 3,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  securityGroups: [ecsSecurityGroup],
});

    // Create an SSL certificate for the NLB
    const nlbCertificate = new acm.Certificate(this, 'NLBCertificate', {
      domainName: nlbDomainName,
      validation: acm.CertificateValidation.fromDns(),
    });

// Network Load Balancer
const nlb = new elbv2.NetworkLoadBalancer(this, 'NLB', {
  vpc,
  internetFacing: true,
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
});

const listener = nlb.addListener('Listener', {
  port: 443,
  certificates: [nlbCertificate],
  sslPolicy: elbv2.SslPolicy.RECOMMENDED,
});

listener.addTargets('ECS', {
  port: 8080,
  protocol: elbv2.Protocol.TCP,
  targets: [fargateService],
  healthCheck: {
    protocol: elbv2.Protocol.TCP,
    interval: cdk.Duration.seconds(10),
    timeout: cdk.Duration.seconds(5),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 2,
  }
});

// CloudFront Distribution
const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.HttpOrigin(nlbDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      keepaliveTimeout: cdk.Duration.seconds(60),
      connectionAttempts: 3,
      readTimeout: cdk.Duration.seconds(30),
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
  },
});

// Output the CloudFront Distribution URL
new cdk.CfnOutput(this, 'DistributionDomainName', {
  value: distribution.distributionDomainName,
  description: 'CloudFront Distribution Domain Name',
});
  }
}
