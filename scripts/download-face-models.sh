#!/bin/bash
# Download face-api.js model weights to public/models/
# These are the tiny models (~270KB total) — ideal for mobile web.

set -e

MODELS_DIR="public/models"
BASE_URL="https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"

mkdir -p "$MODELS_DIR"

echo "Downloading face-api.js tiny models..."

# Tiny Face Detector (~190KB)
curl -sL "$BASE_URL/tiny_face_detector_model-shard1" -o "$MODELS_DIR/tiny_face_detector_model-shard1"
curl -sL "$BASE_URL/tiny_face_detector_model-weights_manifest.json" -o "$MODELS_DIR/tiny_face_detector_model-weights_manifest.json"

# Tiny Face Landmark 68 (~80KB)
curl -sL "$BASE_URL/face_landmark_68_tiny_model-shard1" -o "$MODELS_DIR/face_landmark_68_tiny_model-shard1"
curl -sL "$BASE_URL/face_landmark_68_tiny_model-weights_manifest.json" -o "$MODELS_DIR/face_landmark_68_tiny_model-weights_manifest.json"

echo ""
echo "✓ Models downloaded to $MODELS_DIR/"
echo "  - Tiny Face Detector: $(du -h "$MODELS_DIR/tiny_face_detector_model-shard1" | cut -f1)"
echo "  - Tiny Face Landmark:  $(du -h "$MODELS_DIR/face_landmark_68_tiny_model-shard1" | cut -f1)"
echo "  Total: ~270KB — mobile-friendly"
