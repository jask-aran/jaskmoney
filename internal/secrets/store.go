package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// lightweight per-user secret store (file, 0600) with AES-GCM obfuscation.
// Not a replacement for OS keychains but avoids plain-text config.

const fileName = "keys.json"

type secretFile struct {
	Keys map[string]string `json:"keys"` // provider -> base64(ciphertext)
}

func StoreProviderKey(provider, key string) error {
	if provider = norm(provider); provider == "" {
		return fmt.Errorf("provider required")
	}
	path, err := filePath()
	if err != nil {
		return err
	}
	sf, _ := load(path)
	if sf.Keys == nil {
		sf.Keys = map[string]string{}
	}
	ct, err := encrypt([]byte(key))
	if err != nil {
		return err
	}
	sf.Keys[provider] = base64.StdEncoding.EncodeToString(ct)
	return save(path, sf)
}

func FetchProviderKey(provider string) (string, error) {
	if provider = norm(provider); provider == "" {
		return "", fmt.Errorf("provider required")
	}
	path, err := filePath()
	if err != nil {
		return "", err
	}
	sf, err := load(path)
	if err != nil {
		return "", err
	}
	enc, ok := sf.Keys[provider]
	if !ok {
		return "", fmt.Errorf("key not found")
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	pt, err := decrypt(raw)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func DeleteProviderKey(provider string) error {
	if provider = norm(provider); provider == "" {
		return fmt.Errorf("provider required")
	}
	path, err := filePath()
	if err != nil {
		return err
	}
	sf, err := load(path)
	if err != nil {
		return err
	}
	delete(sf.Keys, provider)
	return save(path, sf)
}

func filePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "jaskmoney")
	if err := os.MkdirAll(dir, 0o700); err != nil { // restrict directory
		return "", err
	}
	return filepath.Join(dir, fileName), nil
}

func load(path string) (secretFile, error) {
	var sf secretFile
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return secretFile{}, nil
		}
		return sf, err
	}
	if err := json.Unmarshal(data, &sf); err != nil {
		return sf, err
	}
	return sf, nil
}

func save(path string, sf secretFile) error {
	data, err := json.MarshalIndent(sf, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func norm(s string) string {
	return strings.TrimSpace(strings.ToLower(s))
}

func masterKey() ([]byte, error) {
	user := os.Getenv("USER")
	base := fmt.Sprintf("jaskmoney-%s-%s", runtime.GOOS, user)
	hash := sha256.Sum256([]byte(base))
	return hash[:], nil
}

func encrypt(plain []byte) ([]byte, error) {
	key, err := masterKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func decrypt(ciphertext []byte) ([]byte, error) {
	key, err := masterKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce := ciphertext[:gcm.NonceSize()]
	body := ciphertext[gcm.NonceSize():]
	return gcm.Open(nil, nonce, body, nil)
}
