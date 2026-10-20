# Build script for RouterOS x86_64 Container
# Run this on Windows PowerShell with Docker Desktop installed

# Stop on error
$ErrorActionPreference = "Stop"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "MikroTik Controller Container Builder" -ForegroundColor Cyan
Write-Host "Target: linux/amd64 (RouterOS x86_64)" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$IMAGE_NAME = "mikrotik-controller"
$IMAGE_TAG = "latest"
$OUTPUT_FILE = "mikrotik-controller-amd64.tar"

# Step 1: Check Docker is running
Write-Host "[1/5] Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker version --format '{{.Server.Version}}'
    Write-Host "  [OK] Docker version: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Docker is not running or not installed" -ForegroundColor Red
    Write-Host "  Please start Docker Desktop and try again" -ForegroundColor Red
    exit 1
}

# Step 2: Enable Buildx (for cross-platform builds)
Write-Host "[2/5] Setting up Buildx..." -ForegroundColor Yellow
$builderName = "multiplatform-builder"
$existingBuilder = docker buildx ls --format '{{.Name}}' | Select-String -Pattern $builderName

if (-not $existingBuilder) {
    Write-Host "  Creating new builder: $builderName" -ForegroundColor Gray
    docker buildx create --name $builderName --use | Out-Null
} else {
    Write-Host "  Using existing builder: $builderName" -ForegroundColor Gray
    docker buildx use $builderName | Out-Null
}
Write-Host "  [OK] Builder ready" -ForegroundColor Green

# Step 3: Build the image for linux/amd64
Write-Host "[3/5] Building container image (linux/amd64)..." -ForegroundColor Yellow
Write-Host "  This may take several minutes on first build..." -ForegroundColor Gray

docker buildx build --platform linux/amd64 --tag "${IMAGE_NAME}:${IMAGE_TAG}" --load .

if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Image built successfully" -ForegroundColor Green

# Step 4: Export to tar file
Write-Host "[4/5] Exporting to tar archive..." -ForegroundColor Yellow
Write-Host "  Output: $OUTPUT_FILE" -ForegroundColor Gray

docker save --output $OUTPUT_FILE "${IMAGE_NAME}:${IMAGE_TAG}"

if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Export failed!" -ForegroundColor Red
    exit 1
}

$fileSize = (Get-Item $OUTPUT_FILE).Length / 1MB
Write-Host "  [OK] Exported successfully ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green

# Step 5: Show image info
Write-Host "[5/5] Container image details:" -ForegroundColor Yellow
docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}"

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Build Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output file: $OUTPUT_FILE" -ForegroundColor White
Write-Host ""
Write-Host "Next steps for RouterOS deployment:" -ForegroundColor Yellow
Write-Host "1. Transfer $OUTPUT_FILE to your MikroTik router" -ForegroundColor White
Write-Host "2. Import container in RouterOS terminal:" -ForegroundColor White
Write-Host "   /container import file-name=$OUTPUT_FILE" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Configure container:" -ForegroundColor White
Write-Host "   /container config set registry-url=https://registry-1.docker.io" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Create and start container:" -ForegroundColor White
Write-Host "   /container add" -ForegroundColor Cyan
Write-Host "   Set: name=mikrotik-controller, image=${IMAGE_NAME}:${IMAGE_TAG}" -ForegroundColor Gray
Write-Host "   Set: interface=veth1 (or create new veth interface)" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Mount /app/data for database persistence" -ForegroundColor White
Write-Host ""
