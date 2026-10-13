package auth

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestPasswordHashAndVerification(t *testing.T) {
	hasher := NewHasher(2)
	ctx := context.Background()
	first, err := hasher.Hash(ctx, "an intentionally long password")
	if err != nil {
		t.Fatal(err)
	}
	second, err := hasher.Hash(ctx, "an intentionally long password")
	if err != nil {
		t.Fatal(err)
	}
	if first == second || !strings.HasPrefix(first, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatal("random salt and bounded Argon2id parameters expected")
	}
	match, err := hasher.Verify(ctx, first, "an intentionally long password")
	if err != nil || !match {
		t.Fatal("correct password must verify")
	}
	match, err = hasher.Verify(ctx, first, "wrong password")
	if err != nil || match {
		t.Fatal("wrong password must fail")
	}
}
func TestMalformedHashFailsClosed(t *testing.T) {
	for _, value := range []string{"", "plain text", "$argon2id$v=19$m=99999999,t=3,p=2$c2FsdA$aGFzaA", "$argon2id$v=19$m=65536,t=3,p=0$c2FsdA$aGFzaA"} {
		valid, err := NewHasher(1).Verify(context.Background(), value, "password")
		if err != nil || valid {
			t.Fatal("malformed hash must fail without doing unbounded work")
		}
	}
}
func TestHashWaitHonorsCancellation(t *testing.T) {
	hasher := NewHasher(1)
	hasher.slots <- struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := hasher.Hash(ctx, "password"); err != context.Canceled {
		t.Fatal("waiting request must observe context cancellation")
	}
	<-hasher.slots
}
func TestSessionTokensAreRandomCanonicalAndHashed(t *testing.T) {
	first, hash, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if first == second || len(first) != 43 || len(hash) != 32 || !ValidToken(first) || !bytes.Equal(hash, TokenHash(first)) {
		t.Fatal("session entropy, encoding and hash invariant failed")
	}
	for _, token := range []string{"", first + "=", "a short token"} {
		if ValidToken(token) {
			t.Fatal("noncanonical token accepted")
		}
	}
}
