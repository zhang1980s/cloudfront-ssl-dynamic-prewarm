#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CloudfrontDynamicAPIStack } from '../lib/cloudfront-dynamic-api-stack';
import { LambdaPrewarmStack } from '../lib/lambda-prewarm-stack';

const app = new cdk.App();
const projectName = app.node.tryGetContext('projectName') || 'CloudfrontLab';

const env = {
  account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
};

const cloudfrontDynamicAPIStack = new CloudfrontDynamicAPIStack(app, 'CloudfrontDynamicAPIStack', {
  stackName: `${projectName}-CloudfrontDynamicAPIStack`,
  env: env,
});


const lambdaPrewarmStack = new LambdaPrewarmStack(app, 'LambdaPrewarmStack', {
  stackName: `${projectName}-LambdaPrewarmStack`,
  env: env,
});

// lambdaPrewarmStack.addDependency(cloudfrontDynamicAPIStack, 'Cloudfront must be deployed before Lambda Prewarm');

app.synth();