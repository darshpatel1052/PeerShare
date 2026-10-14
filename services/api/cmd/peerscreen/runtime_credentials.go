package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"
)

// Invoked by the AWS SDK's credential_process provider, never by a browser.
// Stdout is the SDK credential protocol and must not be copied to diagnostics.
func runtimeCredentials() error {
	file, err := os.Open("/run/aws/credentials.json")
	if err != nil {
		return errors.New("runtime role credentials unavailable")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Mode().Perm() != 0600 {
		return errors.New("runtime credentials require mode 0600")
	}
	var value struct {
		Version         int       `json:"Version"`
		AccessKeyID     string    `json:"AccessKeyId"`
		SecretAccessKey string    `json:"SecretAccessKey"`
		SessionToken    string    `json:"SessionToken"`
		Expiration      time.Time `json:"Expiration"`
	}
	decoder := json.NewDecoder(io.LimitReader(file, 16385))
	if decoder.Decode(&value) != nil || value.Version != 1 || len(value.AccessKeyID) < 16 || len(value.SecretAccessKey) < 16 || value.SessionToken == "" || !value.Expiration.After(time.Now().Add(30*time.Second)) {
		return errors.New("runtime role credentials are incomplete or expired")
	}
	return json.NewEncoder(os.Stdout).Encode(value)
}
