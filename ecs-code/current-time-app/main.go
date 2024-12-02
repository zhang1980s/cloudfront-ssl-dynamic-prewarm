package main

import (
	"fmt"
	"net/http"
	"time"
)

func currentTimeHandler(w http.ResponseWriter, r *http.Request) {
	currentTime := time.Now().Format(time.RFC1123)
	fmt.Fprintf(w, "Current date and time: %s", currentTime)
}

func main() {
	http.HandleFunc("/", currentTimeHandler)
	http.ListenAndServe(":8080", nil)
}
