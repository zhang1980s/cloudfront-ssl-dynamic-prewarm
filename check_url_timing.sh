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