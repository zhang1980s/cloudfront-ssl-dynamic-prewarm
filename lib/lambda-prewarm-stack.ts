import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';


export class LambdaPrewarmStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const customDomain = new cdk.CfnParameter(this, 'customDomain', {
            type: 'String',
            description: 'Custom Domain Name',
            default: 'cloudfrontlab.zzhe.xyz',
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
            default: 'FRA,LHR',
        });

        const requestPerPop = new cdk.CfnParameter(this, 'requestPerPop', {
            type: 'Number',
            description: 'Request number per pop',
            default: '60',
        });

        const refreshInterval = new cdk.CfnParameter(this, 'refreshInterval', {
            type: 'Number',
            description: 'Prewarm refresh interval',
            default: '1',
        })

        const sslPrewarmHandlerLogGroup = new logs.LogGroup(this, 'SslPrewarmHandlerLogGroup', {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });

        const sslPrewarmHandler = new lambda.Function(this, 'SslPrewarmHandler', {
            runtime: lambda.Runtime.PROVIDED_AL2023,
            architecture: lambda.Architecture.ARM_64,
            handler: 'bootstrap',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/ssl-prewarm-handler'), {
                bundling: {
                    image: lambda.Runtime.PROVIDED_AL2023.bundlingImage,
                    command: [
                        'bash',
                        '-c',
                        'export GOARCH=arm64 GOOS=linux && ' +
                        'export GOPATH=/tmp/go && ' +
                        'mkdir -p /tmp/go && ' +
                        'go build -tags lambda.norpc -o bootstrap && ' +
                        'cp bootstrap /asset-output/'
                    ],
                    user: 'root',
                },
            }),
            timeout: cdk.Duration.seconds(30),
            memorySize: 128,
            environment: {
                'CUSTOM_DOMAIN': customDomain.valueAsString,
                'DISTRIBUTION_DOMAIN': distributionDomainName.valueAsString,
                'PATH': uRLpath.valueAsString,
                'POPS': cloudfrontPops.valueAsString,
                'REQUESTS_PER_POP': requestPerPop.valueAsString,
            },
            logGroup: sslPrewarmHandlerLogGroup,
        });

        const SslPrewarmHandlerVersion = sslPrewarmHandler.currentVersion;

        const sslPrewarmHandlerAlias = new lambda.Alias(this, 'SslPrewarmHandlerAlias', {
            aliasName: 'prod',
            version: SslPrewarmHandlerVersion,
        });

        const prewarmScheduleEventRule = new cdk.aws_events.Rule(this, 'PrewarmScheduleEventRule', {
            schedule: cdk.aws_events.Schedule.rate(cdk.Duration.minutes(refreshInterval.valueAsNumber)),
            description: 'Prewarm Schedule Event Rule',
            enabled: true,
        });

        prewarmScheduleEventRule.addTarget(new cdk.aws_events_targets.LambdaFunction(sslPrewarmHandlerAlias));

    }

}
