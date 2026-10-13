package mediasvc

import (
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

func Producer(brokers string) (*kgo.Client, error) {
	if brokers == "" {
		return nil, errors.New("Kafka bootstrap addresses required")
	}
	return kgo.NewClient(kgo.SeedBrokers(strings.Split(brokers, ",")...), kgo.RequiredAcks(kgo.AllISRAcks()), kgo.ProducerBatchMaxBytes(2*1024*1024), kgo.ProducerLinger(0), kgo.RecordDeliveryTimeout(5*time.Second), kgo.ProduceRequestTimeout(3*time.Second))
}
func Consumer(brokers, topic, group string) (*kgo.Client, error) {
	if brokers == "" {
		return nil, errors.New("Kafka bootstrap addresses required")
	}
	return kgo.NewClient(kgo.SeedBrokers(strings.Split(brokers, ",")...), kgo.ConsumeTopics(topic), kgo.ConsumerGroup(group), kgo.DisableAutoCommit(), kgo.BlockRebalanceOnPoll(), kgo.FetchMaxBytes(4*1024*1024), kgo.FetchMaxPartitionBytes(2*1024*1024))
}
func (s *Store) RunMaintenance(ctx context.Context, producer *kgo.Client, logger *slog.Logger) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := s.Reap(ctx); err != nil && ctx.Err() == nil {
			logger.Warn("media_recovery_deferred")
		}
		if err := s.RelayOnce(ctx, producer); err != nil && ctx.Err() == nil {
			logger.Warn("media_outbox_deferred")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Publish first, then record the acknowledgement. An ambiguous response can redeliver the same event ID.
func (s *Store) RelayOnce(ctx context.Context, producer *kgo.Client) error {
	rows, err := s.Pool.Query(ctx, "SELECT id,topic,aggregate_id,payload FROM media.outbox WHERE published_at IS NULL AND next_attempt_at<=now() ORDER BY created_at,id LIMIT 20")
	if err != nil {
		return err
	}
	type item struct {
		id, topic, key string
		payload        []byte
	}
	items := []item{}
	for rows.Next() {
		var event item
		if err = rows.Scan(&event.id, &event.topic, &event.key, &event.payload); err != nil {
			rows.Close()
			return err
		}
		items = append(items, event)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, event := range items {
		request, cancel := context.WithTimeout(ctx, 5*time.Second)
		err = producer.ProduceSync(request, &kgo.Record{Topic: event.topic, Key: []byte(event.key), Value: event.payload}).FirstErr()
		cancel()
		if err != nil {
			_, _ = s.Pool.Exec(ctx, "UPDATE media.outbox SET failures=failures+1,next_attempt_at=now()+interval '2 seconds' WHERE id=$1 AND published_at IS NULL", event.id)
			return err
		}
		if _, err = s.Pool.Exec(ctx, "UPDATE media.outbox SET published_at=COALESCE(published_at,now()) WHERE id=$1", event.id); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) Quarantine(ctx context.Context, record *kgo.Record, reason string) error {
	hash := sha256.Sum256(record.Value)
	_, err := s.Pool.Exec(ctx, "INSERT INTO media.quarantine(topic,partition_id,record_offset,content_sha256,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", record.Topic, record.Partition, record.Offset, hash[:], reason)
	return err
}
