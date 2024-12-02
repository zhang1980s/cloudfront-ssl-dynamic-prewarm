#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CloudfrontSslDynamicPrewarmStack } from '../lib/cloudfront-ssl-dynamic-prewarm-stack';

const app = new cdk.App();
const stackname = app.node.tryGetContext('stackName')
new CloudfrontSslDynamicPrewarmStack(app, 'CloudfrontSslDynamicPrewarmStack', {
  stackName: stackname,
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
  }
});