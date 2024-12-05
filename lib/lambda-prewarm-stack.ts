import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';


export class LambdaPrewarmStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const customDomain = new cdk.CfnParameter(this, 'customDomain', {
            type: 'String',
            description: 'Custom Domain Name',
            default: 'www.example.com',
        });

        const distributionDomainName = new cdk.CfnParameter(this, 'distributionDomainName', {
            type: 'String',
            description: 'Distribution Domain Name',
            default: 'xxxxxxxxxxxxxx',
        });

        const uRLpath = new cdk.CfnParameter(this, 'uRLpath', {
            type: 'String',
            description: 'Path of URL',
            default: '/',
        });

        const cloudfrontPops = new cdk.CfnParameter(this, 'cloudfrontPops', {
            type: 'String',
            description: 'Pop name list of Cloudfront',
            default: 'HKG1-P1,HKG1-P2,HKG54-C1,HKG54-P1,HKG54-P2,HKG60-C1,HKG62-C1,HKG62-C2,HKG62-P1',
        });

        const requestPerPop = new cdk.CfnParameter(this, 'requestPerPop', {
            type: 'Number',
            description: 'Request number per pop',
            default: '60',
        });


        const sslPrewarmHandlerLogGroup = new logs.LogGroup(this, 'SslPrewarmHandlerLogGroup', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        const sslPrewarmHandler = new NodejsFunction(this, 'SslPrewarmHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            architecture: lambda.Architecture.ARM_64,
            entry: path.join(__dirname, '../lambda/ssl-prewarm-handler/scheduled-event-logger.mjs'),
            handler: "scheduledEventLoggerHandler",
            timeout: cdk.Duration.minutes(10),
            memorySize: 4096,
            environment: {
                'CUSTOM_DOMAIN': customDomain.valueAsString,
                'DISTRIBUTION_ID': distributionDomainName.valueAsString,
                'PATH': uRLpath.valueAsString,
                'POPS': cloudfrontPops.valueAsString,
                'REQUESTS_PER_POP': requestPerPop.valueAsString,
            },
            logGroup: sslPrewarmHandlerLogGroup,
            bundling: {
                externalModules: ['aws-sdk'],
                nodeModules: ['aws-xray-sdk'],
              },
              tracing: lambda.Tracing.ACTIVE,
        });

        sslPrewarmHandler.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
            resources: ['*'],
        }));

        const prewarmScheduleEventRule = new events.Rule(this, 'PrewarmScheduleEventRule', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
            description: `Prewarm Schedule Event every 1 minute(s)`,
            enabled: false,
        });

        prewarmScheduleEventRule.addTarget(new cdk.aws_events_targets.LambdaFunction(sslPrewarmHandler, {
            event: events.RuleTargetInput.fromObject({
                'action': 'prewarm',
            }),
        }));

    }

}
