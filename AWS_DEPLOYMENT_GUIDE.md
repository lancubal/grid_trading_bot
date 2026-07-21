# 🚀 Guía Completa de Despliegue en AWS con GitHub Actions CI/CD

Esta guía detalla el procedimiento paso a paso para desplegar automáticamente tu **Bot de Grid Trading (BTC/USDT)** en una instancia de **AWS EC2** (o AWS Lightsail) conectada con **GitHub Actions**.

---

## 🏗️ Arquitectura de Producción en AWS

```mermaid
graph TD
    GH[GitHub Repository - main] -->|git push| GHA[GitHub Actions CI/CD]
    GHA -->|1. Run npm test & build| TEST[Vitest & TSC Check]
    TEST -->|2. SSH Connection| EC2[AWS EC2 Instance - Ubuntu 24.04]
    EC2 -->|docker-compose up -d| DC[Docker Compose Engine]
    DC --> DB[(PostgreSQL 16 Container)]
    DC --> BOT[Grid Trading Bot Container]
    BOT <-->|WebSockets & REST| BINANCE[Binance Spot API]
```

---

## 📌 Paso 1: Crear la Instancia AWS EC2

1. Inicia sesión en **AWS Console** y ve a **EC2 -> Launch Instance**.
2. **Nombre:** `grid-trading-bot-prod`
3. **AMI:** Ubuntu Server 24.04 LTS (64-bit x86).
4. **Tipo de Instancia:** `t3.micro` (Elegible para capa gratuita) o `t3.small` (Recomendada).
5. **Key Pair:** Crea o selecciona un par de llaves SSH (ej: `trading-bot-key.pem`).
6. **Network Settings (Security Group):**
   - Regla 1: SSH (Puerto `22`) - Permitir desde cualquier IP (`0.0.0.0/0`) o IP personalizada.
7. **Almacenamiento:** 15 GB General Purpose SSD (gp3).
8. Haz clic en **Launch Instance**.

---

## 📌 Paso 2: Preparar la Instancia EC2 (Una Sola Vez)

Conéctate a tu instancia EC2 por SSH desde tu terminal:
```bash
ssh -i ./Downloads/trading-bot-key.pem ubuntu@100.27.216.84
```

Una vez dentro de la consola de la instancia EC2, ejecuta los siguientes comandos para instalar Docker y Git:

```bash
# Update paquetes del sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker y Docker Compose
sudo apt install -y docker.io docker-compose git

# Habilitar Docker para iniciar automáticamente al reiniciar el servidor
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu

# Generar SSH key en la EC2 para clonar el repositorio de GitHub (si el repo es privado)
ssh-keygen -t ed25519 -C "aws-ec2-bot" -N ""
cat ~/.ssh/id_ed25519.pub
```
*(Copia la clave pública e agrégala en GitHub: `Repo -> Settings -> Deploy Keys`)*.

---

## 📌 Paso 3: Configurar Secretos en GitHub

En tu repositorio de GitHub, ve a **Settings ➔ Secrets and variables ➔ Actions ➔ New repository secret**:

1. **`AWS_HOST`**: La IP pública de tu instancia AWS EC2 (ej: `100.27.216.84`).
2. **`AWS_USERNAME`**: `ubuntu`
3. **`AWS_SSH_KEY`**: El contenido completo de tu llave privada `.pem` descargada de AWS.
4. **`ENV_FILE`**: El contenido completo de tu archivo `.env` configurado para producción o Shadow Trading:
   ```env
   NODE_ENV="production"
   PORT=3000
   DRY_RUN="true"
   GRID_SYMBOL="BTC/USDT"
   GRID_LEVELS="15"
   GRID_INVESTMENT="1000.00"
   ATR_PERIOD="14"
   ATR_TIMEFRAME="1h"
   MIN_GRID_RANGE_USD="1500.00"
   MAX_GRID_RANGE_USD="6000.00"
   MAX_ORDER_VALUE_USD="150.00"
   MAX_OPEN_ORDERS="20"
   DATABASE_URL="postgresql://postgres:postgres@postgres:5432/grid_bot?schema=public"
   EXCHANGE_ID="binance"
   EXCHANGE_API_KEY="tu_api_key"
   EXCHANGE_API_SECRET="tu_api_secret"
   EXCHANGE_TESTNET="false"
   ```

---

## 📌 Paso 4: Despliegue Automatizado (CI/CD)

Cada vez que hagas `git push origin main`, GitHub Actions ejecutará automáticamente:
1. `npm test`: Ejecutará las 24 pruebas unitarias.
2. `npm run build`: Verificará que el código en TypeScript compile sin errores.
3. **SSH Deployment:** Se conectará a tu instancia AWS EC2 y actualizará los contenedores Docker en segundo plano con `docker-compose up -d --build`.

---

## 🔍 Monitoreo en Vivo en AWS

Para consultar los logs en vivo del bot desplegado en AWS:
```bash
# Conectarse a la EC2
ssh -i ./Downloads/trading-bot-key.pem ubuntu@100.27.216.84

# Ver logs en tiempo real del contenedor del bot
docker logs -f grid_trading_bot

# Ver estado de los contenedores
docker-compose ps
```
