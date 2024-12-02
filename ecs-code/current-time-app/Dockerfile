# Use the official Golang image to create a build artifact.
FROM golang:1.22 AS builder

# Set the working directory inside the container.
WORKDIR /app

# Copy the source code into the container.
COPY . .

# Build the Go app with static linking
RUN CGO_ENABLED=0 GOARCH=arm64 GOOS=linux go build -a -installsuffix cgo -o /current-time-app .

# Use a minimal image for running the application.
FROM alpine:3.18

# Copy the binary from the builder stage.
COPY --from=builder /current-time-app /current-time-app

# Expose port 8080 to the outside world.
EXPOSE 8080

# Command to run the executable
CMD ["/current-time-app"]