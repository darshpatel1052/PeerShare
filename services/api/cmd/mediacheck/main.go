// A diagnostic client used by the isolated process-recovery runner. Credentials stay in its environment.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"os"
	"time"

	pb "github.com/darshpatel1052/Peer-Screen/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/Peer-Screen/services/api/internal/mediasvc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func main() {
	job := flag.String("job", "", "job identifier")
	attempt := flag.String("attempt", "", "attempt identifier")
	worker := flag.String("worker", "", "worker identifier")
	epoch := flag.Int64("epoch", 0, "lease epoch")
	descriptor := flag.String("descriptor", "", "output descriptor key")
	flag.Parse()
	client, err := mediasvc.Dial(os.Getenv("MEDIA_GRPC_ADDR"), os.Getenv("WORKER_RPC_TOKEN"))
	if err != nil {
		os.Exit(1)
	}
	defer client.Conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = client.CompleteJob(ctx, &pb.CompleteRequest{Attempt: &pb.Attempt{JobId: *job, AttemptId: *attempt, WorkerId: *worker, LeaseEpoch: *epoch}, OutputDescriptorKey: *descriptor})
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"status_code": status.Code(err).String()})
	if status.Code(err) != codes.FailedPrecondition {
		os.Exit(1)
	}
}
