package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

func NewSessionToken() (string, []byte, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	return token, TokenHash(token), nil
}

func TokenHash(token string) []byte { hash := sha256.Sum256([]byte(token)); return hash[:] }
func ValidToken(token string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(decoded) == 32 && base64.RawURLEncoding.EncodeToString(decoded) == token
}
