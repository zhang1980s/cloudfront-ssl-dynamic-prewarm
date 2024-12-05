# Prewarm cloudfront for dynamic requests

## Introduction

CloudFront can be used to accelerate dynamic HTTP(S) APIs from the backend. However, when dynamic requests are infrequent, latency can increase due to the establishing of TCP/SSL connections between CloudFront POP locations and the backend custom domain.

This issue can be addressed through the following two steps:

1. Adjust the Keep-alive timeout parameter for the CloudFront custom domain:
   Increase the default value from 5 seconds to 60 seconds. This extended timeout helps maintain connections for longer periods, reducing the need for frequent reconnections.

2. Implement Lambda-based prewarming solution:
   Use Lambda functions to "prewarm" CloudFront PoP locations in regions with less frequent access. This approach helps reduce the probability of new TCP/SSL handshakes by maintaining active connections, thereby decreasing overall latency.


## Architecture

![Architecture](./picture/cloudfront-prewarm.drawio.png)

## Implementation
### The backend application in ecs-code/current-time-app

1. go mod init current-time-app
2. main.go and main_test.go
3. Dockerfile

### Create ECR 

```
aws ecr create-repository --repository-name current-time-app
```

### Pushing docker images to ECR

https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html


```
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.<region>.amazonaws.com
```

```
# Build your Docker image
docker build -t current-time-app .

# Tag your image for ECR
docker tag current-time-app:latest <your_account_id>.dkr.ecr.<region>.amazonaws.com/current-time-app:latest

# Push your image to ECR
docker push <your_account_id>.dkr.ecr.<region>.amazonaws.com/current-time-app:latest
```

## Deploy Verification environment via CDK

### Backend stack

```
./cdk-deploy-to.sh <backend account> <backend region> CloudfrontDynamicAPIStack
```

### Prewarm stack

```
./cdk-deploy-to.sh <pre-warm account> <pre-warm region> LambdaPrewarmStack
```

## Test

### Test script

**check_url_timing.sh**

```
#!/bin/bash

# Check if a URL is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <URL>"
    exit 1
fi

# Store the URL from the command line argument
URL=$1

# Execute the curl command and store the output
output=$(curl -w "%{time_total},%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer}" -o /dev/null -s -D - "$URL")

# Extract the x-amz-cf-id from the headers
x_amz_cf_id=$(echo "$output" | grep -i "x-amz-cf-id:" | awk '{print $2}' | tr -d '\r')

# Extract the timing information
timing=$(echo "$output" | tail -n 1)

# Combine all information into a single line
echo "$timing,$x_amz_cf_id" | awk -F',' '{printf "Total: %.6f, DNS: %.6f, TCP: %.6f, SSL: %.6f, Request: %.6f, x-amz-cf-id: %s\n", $1, $2, $3, $4, $5, $6}'
```

### How it works
```
./check_url_timing.sh https://<domain>/
```

### Test for a range of time

```
for i in `seq 1 100`; do ./check_url_timing.sh https://<domain>/ ; sleep 10; done
```

## Test data