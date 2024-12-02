# Prewarm cloudfront

## Create go application in ecs-code/current-time-app

1. go mod init current-time-app
2. main.go and main_test.go
3. Dockerfile

## Create ECR 

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

## Create cdk environment

## Test

```
#!/bin/bash

# Check if a URL is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <URL>"
    exit 1
fi

# Store the URL from the command line argument
URL=$1

# Execute the curl command with the provided URL
curl -w "Total time: %{time_total} seconds\nDNS resolution time: %{time_namelookup} seconds\nTCP connection time: %{time_connect} seconds\nSSL handshake time: %{time_appconnect} seconds\nTime to send request: %{time_starttransfer} seconds\n" -o /dev/null -s "$URL" -v
```

```
./check_url_timing.sh https://<domain>/<url>
```


