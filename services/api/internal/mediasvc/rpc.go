package mediasvc

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type Server struct {
	pb.UnimplementedMediaCoordinatorServer
	Store *Store
}

func (s *Server) SubmitProcessingJob(ctx context.Context, r *pb.JobSpec) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Submit(ctx, r))
}
func (s *Server) GetJob(ctx context.Context, r *pb.JobRequest) (*pb.JobSnapshot, error) {
	if r == nil {
		return nil, status.Error(codes.InvalidArgument, "missing job")
	}
	return rpcResult(s.Store.Get(ctx, r.JobId))
}
func (s *Server) CancelJob(ctx context.Context, r *pb.JobRequest) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Command(ctx, r, false))
}
func (s *Server) RetryJob(ctx context.Context, r *pb.JobRequest) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Command(ctx, r, true))
}
func (s *Server) ClaimJob(ctx context.Context, r *pb.ClaimRequest) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Claim(ctx, r))
}
func (s *Server) HeartbeatJob(ctx context.Context, r *pb.HeartbeatRequest) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Heartbeat(ctx, r))
}
func (s *Server) CompleteJob(ctx context.Context, r *pb.CompleteRequest) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Complete(ctx, r))
}
func (s *Server) FailJob(ctx context.Context, r *pb.FailRequest) (*pb.JobSnapshot, error) {
	return rpcResult(s.Store.Fail(ctx, r))
}
func rpcResult(job *pb.JobSnapshot, err error) (*pb.JobSnapshot, error) {
	if err == nil {
		return job, nil
	}
	if _, ok := status.FromError(err); ok {
		return nil, err
	}
	return nil, status.Error(codes.Unavailable, "media dependency unavailable")
}

// Different credentials restrict catalogue commands and worker attempt capabilities.
// Plaintext transport is confined to the current private single-host development runtime.
func NewServer(store *Store, catalogToken, workerToken string) (*grpc.Server, error) {
	if len(catalogToken) != 64 || len(workerToken) != 64 || catalogToken == workerToken {
		return nil, errors.New("distinct private service credentials are required")
	}
	interceptor := func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		meta, _ := metadata.FromIncomingContext(ctx)
		values := meta.Get("authorization")
		if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
			return nil, status.Error(codes.Unauthenticated, "service authentication required")
		}
		token := strings.TrimPrefix(values[0], "Bearer ")
		catalog := subtle.ConstantTimeCompare([]byte(token), []byte(catalogToken)) == 1
		worker := subtle.ConstantTimeCompare([]byte(token), []byte(workerToken)) == 1
		if !catalog && !worker {
			return nil, status.Error(codes.Unauthenticated, "invalid service authentication")
		}
		method := info.FullMethod[strings.LastIndex(info.FullMethod, "/")+1:]
		catalogMethod := map[string]bool{"SubmitProcessingJob": true, "GetJob": true, "CancelJob": true, "RetryJob": true}[method]
		workerMethod := map[string]bool{"GetJob": true, "ClaimJob": true, "HeartbeatJob": true, "CompleteJob": true, "FailJob": true}[method]
		if !(catalog && catalogMethod || worker && workerMethod) {
			return nil, status.Error(codes.PermissionDenied, "service cannot perform this command")
		}
		timeout := 5 * time.Second
		if method == "CompleteJob" {
			timeout = 90 * time.Second
		}
		bounded, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return handler(bounded, req)
	}
	server := grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()), grpc.UnaryInterceptor(interceptor), grpc.MaxRecvMsgSize(2*1024*1024), grpc.MaxSendMsgSize(2*1024*1024))
	pb.RegisterMediaCoordinatorServer(server, &Server{Store: store})
	return server, nil
}

type Client struct {
	pb.MediaCoordinatorClient
	Conn *grpc.ClientConn
}

func Dial(target, token string) (*Client, error) {
	if target == "" || len(token) != 64 {
		return nil, errors.New("media target and private service credential required")
	}
	conn, err := grpc.NewClient(target, grpc.WithStatsHandler(otelgrpc.NewClientHandler()), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(2*1024*1024), grpc.MaxCallSendMsgSize(2*1024*1024)), grpc.WithUnaryInterceptor(func(ctx context.Context, method string, req, reply any, connection *grpc.ClientConn, invoke grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		timeout := 5 * time.Second
		if strings.HasSuffix(method, "/CompleteJob") {
			timeout = 90 * time.Second
		}
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
		return invoke(ctx, method, req, reply, connection, opts...)
	}))
	if err != nil {
		return nil, err
	}
	return &Client{pb.NewMediaCoordinatorClient(conn), conn}, nil
}
