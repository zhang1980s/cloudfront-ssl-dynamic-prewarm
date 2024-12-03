package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-xray-sdk-go/xray"
)

type Result struct {
	Pop     string
	Metrics Metrics
	Headers http.Header
	Body    []byte
}

type Metrics struct {
	TTFB              time.Duration
	FirstChunkTime    time.Duration
	EndTime           time.Duration
	DNSLookupTime     time.Duration
	TCPConnectionTime time.Duration
	TLSHandshakeTime  time.Duration
}

func getIPAddress(domain string) (string, error) {
	_, seg := xray.BeginSubsegment(context.Background(), "dns-lookup")
	defer seg.Close(nil)

	ips, err := net.LookupIP(domain)
	if err != nil {
		return "", fmt.Errorf("error looking up IP for %s: %w", domain, err)
	}

	if len(ips) == 0 {
		return "", fmt.Errorf("no IP addresses found for %s", domain)
	}

	return ips[0].String(), nil
}

func digIPForPops(distributionID string, pops []string) (map[string]string, error) {
	_, seg := xray.BeginSubsegment(context.Background(), "dig-pops-ip")
	defer seg.Close(nil)

	ipMap := make(map[string]string)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, pop := range pops {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			domain := fmt.Sprintf("%s.%s.cloudfront.net", distributionID, p)
			ip, err := getIPAddress(domain)
			if err != nil {
				fmt.Printf("Error fetching IP for %s: %v\n", domain, err)
				return
			}
			mu.Lock()
			ipMap[p] = ip
			mu.Unlock()
		}(pop)
	}

	wg.Wait()
	return ipMap, nil
}

func fetchViaSpecificPop(ctx context.Context, customDomain, distributionID, pop, ip, pathname string) (*Result, error) {
	ctx, seg := xray.BeginSubsegment(ctx, fmt.Sprintf("fetch-pop-%s", pop))
	defer seg.Close(nil)

	realDomain := fmt.Sprintf("%s.cloudfront.net", distributionID)
	if customDomain != "" && customDomain != "www.example.com" {
		realDomain = customDomain
	}
	url := fmt.Sprintf("https://%s%s", realDomain, pathname)

	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, ip+":443")
		},
		TLSHandshakeTimeout: 10 * time.Second,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}
	req.Host = realDomain

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error making request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %w", err)
	}

	result := &Result{
		Pop:     pop,
		Metrics: Metrics{EndTime: time.Since(start)},
		Headers: resp.Header,
		Body:    body,
	}

	return result, nil
}

func handleRequest(ctx context.Context) error {
	distributionID := os.Getenv("DISTRIBUTION_ID")
	pathname := os.Getenv("PATH")
	pops := strings.Split(os.Getenv("POPS"), ",")
	requestsPerPop, _ := strconv.Atoi(os.Getenv("REQUESTS_PER_POP"))
	customDomain := os.Getenv("CUSTOM_DOMAIN")

	ipMap, err := digIPForPops(distributionID, pops)
	if err != nil {
		return fmt.Errorf("error digging IPs for POPs: %w", err)
	}

	var wg sync.WaitGroup
	results := make(chan *Result, len(pops)*requestsPerPop)

	for _, pop := range pops {
		ip := ipMap[pop]
		for i := 0; i < requestsPerPop; i++ {
			wg.Add(1)
			go func(p, ipAddr string) {
				defer wg.Done()
				result, err := fetchViaSpecificPop(ctx, customDomain, distributionID, p, ipAddr, pathname)
				if err != nil {
					fmt.Printf("Error fetching via POP %s: %v\n", p, err)
					return
				}
				results <- result
			}(pop, ip)
		}
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("error loading AWS config: %w", err)
	}

	cw := cloudwatch.NewFromConfig(cfg)

	for result := range results {
		_, err := cw.PutMetricData(ctx, &cloudwatch.PutMetricDataInput{
			Namespace: aws.String("CustomCloudFrontMetrics"),
			MetricData: []types.MetricDatum{
				{
					MetricName: aws.String("ResponseTime"),
					Dimensions: []types.Dimension{
						{Name: aws.String("POP"), Value: aws.String(result.Pop)},
					},
					Value: aws.Float64(float64(result.Metrics.EndTime.Milliseconds())),
					Unit:  types.StandardUnitMilliseconds,
				},
			},
		})
		if err != nil {
			fmt.Printf("Error putting metric data: %v\n", err)
		}
	}

	return nil
}

func main() {
	lambda.Start(handleRequest)
}
