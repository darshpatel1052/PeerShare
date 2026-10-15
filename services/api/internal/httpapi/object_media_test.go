package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMediaAdmissionQueuesAndReleasesCancelledViewer(t *testing.T) {
	a := &App{mediaSlots: make(chan struct{}, 1), mediaAdmission: make(chan struct{}, 2)}
	release, err := a.acquireMediaRead(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	queued := make(chan error, 1)
	go func() {
		free, e := a.acquireMediaRead(ctx)
		if free != nil {
			free()
		}
		queued <- e
	}()
	deadline := time.Now().Add(time.Second)
	for len(a.mediaAdmission) != 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(a.mediaAdmission) != 2 {
		release()
		t.Fatal("second viewer did not enter the bounded queue")
	}
	if free, e := a.acquireMediaRead(context.Background()); !errors.Is(e, errMediaBusy) {
		if free != nil {
			free()
		}
		release()
		t.Fatal("overflow was not rejected")
	}
	cancel()
	if e := <-queued; !errors.Is(e, context.Canceled) {
		release()
		t.Fatal("disconnected viewer remained queued")
	}
	release()
	next, e := a.acquireMediaRead(context.Background())
	if e != nil {
		t.Fatal("queue leaked capacity:", e)
	}
	next()
	if len(a.mediaSlots) != 0 || len(a.mediaAdmission) != 0 {
		t.Fatal("media admission did not return to empty")
	}
}

func TestMediaAdmissionServesWaitingViewerAfterActiveRead(t *testing.T) {
	a := &App{mediaSlots: make(chan struct{}, 1), mediaAdmission: make(chan struct{}, 2)}
	first, err := a.acquireMediaRead(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	served := make(chan error, 1)
	go func() {
		free, e := a.acquireMediaRead(ctx)
		if free != nil {
			free()
		}
		served <- e
	}()
	for len(a.mediaAdmission) < 2 && ctx.Err() == nil {
		time.Sleep(time.Millisecond)
	}
	first()
	if e := <-served; e != nil {
		t.Fatal("queued viewer was not served:", e)
	}
}
