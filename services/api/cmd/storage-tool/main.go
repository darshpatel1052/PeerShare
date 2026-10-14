package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/objectstore"
	"github.com/google/uuid"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Local storage setup failed:", err)
		os.Exit(1)
	}
}
func run() error {
	endpoint, err := url.Parse(os.Getenv("S3_ENDPOINT"))
	if err != nil || endpoint.Scheme != "http" || (endpoint.Hostname() != "127.0.0.1" && endpoint.Hostname() != "localhost" && endpoint.Hostname() != "s3") || os.Getenv("APP_ENV") == "production" {
		return errors.New("setup is limited to a local development S3 server")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	remote, err := objectstore.FromEnvironment(ctx)
	if err != nil || remote == nil {
		return errors.New("configure the local S3 rehearsal")
	}
	for _, bucket := range []string{remote.Originals, remote.Processed} {
		if _, err = remote.Client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)}); err == nil {
			continue
		}
		_, err = remote.Client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket), CreateBucketConfiguration: &types.CreateBucketConfiguration{LocationConstraint: types.BucketLocationConstraint(os.Getenv("AWS_REGION"))}})
		if err != nil {
			var api smithy.APIError
			var response *smithyhttp.ResponseError
			code := "dependency"
			if errors.As(err, &api) {
				code = api.ErrorCode()
			}
			status := 0
			if errors.As(err, &response) {
				status = response.HTTPStatusCode()
			}
			return fmt.Errorf("local bucket initialization failed (code=%s, HTTP=%d)", code, status)
		}
	}
	if len(os.Args) == 3 && os.Args[1] == "audit-video" {
		id, err := uuid.Parse(os.Args[2])
		if err != nil || id.String() != os.Args[2] {
			return errors.New("use a canonical video ID")
		}
		processed, err := remote.Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(remote.Processed), Prefix: aws.String("videos/" + id.String() + "/")})
		if err != nil {
			return err
		}
		sources, err := remote.Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(remote.Originals), Prefix: aws.String("sources/" + id.String() + "-")})
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]int{"processedObjects": len(processed.Contents), "sourceObjects": len(sources.Contents)})
	}
	fmt.Println("Local private S3 rehearsal buckets ready.")
	return nil
}
