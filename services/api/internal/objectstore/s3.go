// Package objectstore contains server-only S3 transport. PostgreSQL permissions
// remain outside this package; an object key alone never grants browser access.
package objectstore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/google/uuid"
)

type Remote struct {
	Client               *s3.Client
	Originals, Processed string
}

// Empty/local retains the existing filesystem adapter. S3 uses the SDK's
// standard credential chain (profile/SSO/role); no key is kept in application DB.
func FromEnvironment(ctx context.Context) (*Remote, error) {
	mode := os.Getenv("OBJECT_STORAGE")
	if mode == "" || mode == "local" {
		return nil, nil
	}
	if mode != "s3" {
		return nil, errors.New("OBJECT_STORAGE must be local or s3")
	}
	region := os.Getenv("AWS_REGION")
	originals, processed := os.Getenv("S3_ORIGINALS_BUCKET"), os.Getenv("S3_PROCESSED_BUCKET")
	validBucket := regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	if region == "" || !validBucket.MatchString(originals) || !validBucket.MatchString(processed) || originals == processed {
		return nil, errors.New("S3 requires an AWS region and distinct originals/processed bucket names")
	}
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint != "" {
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") || (u.Path != "" && u.Path != "/") || os.Getenv("APP_ENV") == "production" {
			return nil, errors.New("S3_ENDPOINT is a development-only trusted HTTP(S) origin")
		}
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region), awsconfig.WithRetryMaxAttempts(2), awsconfig.WithHTTPClient(&http.Client{Timeout: 45 * time.Second}))
	if err != nil {
		return nil, errors.New("S3 credential configuration is invalid")
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
			o.UsePathStyle = true
		}
	})
	return &Remote{Client: client, Originals: originals, Processed: processed}, nil
}

func ValidKey(key string) bool {
	if key == "" || len(key) > 1024 || strings.HasPrefix(key, "/") || strings.ContainsAny(key, "\\\x00\r\n") || path.Clean(key) != key {
		return false
	}
	for _, part := range strings.Split(key, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}
func missing(err error) error {
	var api smithy.APIError
	if errors.As(err, &api) && (api.ErrorCode() == "NoSuchKey" || api.ErrorCode() == "NotFound") {
		return os.ErrNotExist
	}
	return err
}
func (s *Remote) Read(ctx context.Context, bucket, key string, limit int64) ([]byte, error) {
	body, err := s.Open(ctx, bucket, key, limit)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err == nil && int64(len(data)) > limit {
		err = errors.New("object exceeds read limit")
	}
	return data, err
}

type limitedBody struct {
	io.Reader
	io.Closer
}

func (s *Remote) Open(ctx context.Context, bucket, key string, limit int64) (io.ReadCloser, error) {
	if !ValidKey(key) || limit < 1 {
		return nil, errors.New("invalid object read")
	}
	response, err := s.Client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return nil, missing(err)
	}
	if response.ContentLength != nil && *response.ContentLength > limit {
		response.Body.Close()
		return nil, errors.New("object exceeds read limit")
	}
	return limitedBody{io.LimitReader(response.Body, limit+1), response.Body}, nil
}
func (s *Remote) Put(ctx context.Context, bucket, key string, data []byte) error {
	hash := sha256.Sum256(data)
	return s.put(ctx, bucket, key, bytes.NewReader(data), int64(len(data)), hash[:])
}
func (s *Remote) put(ctx context.Context, bucket, key string, body io.ReadSeeker, size int64, hash []byte) error {
	if !ValidKey(key) {
		return errors.New("invalid object key")
	}
	contentType := mime.TypeByExtension(path.Ext(key))
	if path.Ext(key) == ".m3u8" {
		contentType = "application/vnd.apple.mpegurl"
	}
	if path.Ext(key) == ".ts" {
		contentType = "video/mp2t"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err := s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), Body: body, ContentLength: aws.Int64(size), ContentType: aws.String(contentType), ChecksumSHA256: aws.String(base64.StdEncoding.EncodeToString(hash)), CacheControl: aws.String("no-store")})
	return err
}
func (s *Remote) PutFile(ctx context.Context, bucket, key, file string, limit int64) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(f, limit+1))
	if err != nil || n > limit {
		return errors.New("file exceeds storage limit")
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	return s.put(ctx, bucket, key, f, n, hash.Sum(nil))
}
func (s *Remote) DeletePrefix(ctx context.Context, bucket, prefix string) error {
	if !ValidKey(strings.TrimSuffix(prefix, "/")) || !strings.HasSuffix(prefix, "/") {
		return errors.New("deletion requires a scoped directory prefix")
	}
	return s.deletePrefix(ctx, bucket, prefix)
}

// Sources use video-ID-prefixed immutable filenames rather than directories.
// Include uncommitted assemblies when cleaning an aborted/deleted video, before
// the catalogue releases its reserved capacity.
func (s *Remote) DeleteVideoSources(ctx context.Context, videoID string) error {
	id, err := uuid.Parse(videoID)
	if err != nil || id.String() != videoID {
		return errors.New("source deletion requires a canonical video ID")
	}
	return s.deletePrefix(ctx, s.Originals, "sources/"+videoID+"-")
}

func (s *Remote) deletePrefix(ctx context.Context, bucket, prefix string) error {
	pages := s3.NewListObjectsV2Paginator(s.Client, &s3.ListObjectsV2Input{Bucket: aws.String(bucket), Prefix: aws.String(prefix), MaxKeys: aws.Int32(500)})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return err
		}
		for _, item := range page.Contents {
			if item.Key == nil || !strings.HasPrefix(*item.Key, prefix) {
				return errors.New("storage listing escaped prefix")
			}
			if err = s.Delete(ctx, bucket, *item.Key); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Remote) Delete(ctx context.Context, bucket, key string) error {
	if !ValidKey(key) {
		return errors.New("invalid deletion key")
	}
	_, err := s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	return err
}

func (s *Remote) ListPage(ctx context.Context, bucket string, cursor *string) ([]types.Object, *string, error) {
	page, err := s.Client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{Bucket: aws.String(bucket), ContinuationToken: cursor, MaxKeys: aws.Int32(500)})
	if err != nil {
		return nil, nil, err
	}
	return page.Contents, page.NextContinuationToken, nil
}
