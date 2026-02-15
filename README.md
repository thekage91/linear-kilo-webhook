# Linear → Kilo Webhook Service

Servizio webhook che riceve task assegnati da Linear e li smista agli agenti Kilo Code.

## Architettura

```
Linear Webhook → FastAPI Server → Agent Router → Kilo Cloud Agent
```

## Requisiti

- Python 3.11+
- Linear API Key (opzionale, per fetch aggiuntivi)
- Linear Webhook Secret (opzionale, per verifica firma)
- Kilo API Key (quando Kilo Cloud è abilitato)

## Installazione

### Metodo 1: Python locale

```bash
# Clona il repository
git clone <repository-url>
cd linear-kilo-webhook

# Crea virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# oppure venv\Scripts\activate  # Windows

# Installa dipendenze
pip install -r requirements.txt

# Configura
cp .env.example .env
# Modifica .env con le tue credenziali

# Avvia
uvicorn src.main:app --reload --port 8000
```

### Metodo 2: Docker

```bash
# Configura
cp .env.example .env
# Modifica .env con le tue credenziali

# Avvia con Docker Compose
docker-compose up -d
```

## Configurazione

Edita il file `.env`:

```env
# Linear
LINEAR_WEBHOOK_SECRET=whsec_tuo_secret  # Opzionale, per verifica firma

# Kilo (da configurare quando attivi Cloud Agent)
KILO_CLOUD_ENABLED=false
KILO_API_KEY=kilo_tuo_api_key

# Agent Mapping
AGENT_MAPPING={"davide@example.com": "build", "@example.com": "default-agent"}
```

## Endpoint Webhook

### POST /webhook/linear

Riceve eventi da Linear. Configura il webhook su Linear con questo URL.

Headers richiesti:
- `Content-Type: application/json`
- `linear-signature: <hmac-signature>` (se LINEAR_WEBHOOK_SECRET è configurato)

### GET /health

Health check del servizio.

### GET /ready

Readiness check per orchestratori (Kubernetes, etc.).

### GET /sessions

Lista le sessioni Kilo Cloud Agent attive.

### GET /sessions/{session_id}

Dettagli di una specifica sessione.

## Configurazione Linear

1. Vai su Linear → Settings → API → Webhooks
2. Crea un nuovo webhook
3. URL: `https://tuo-server.com/webhook/linear`
4. Seleziona gli eventi: `Issue` (create, update)
5. Copia il Webhook Secret e mettilo in `.env`

## Agent Mapping

Mappa gli utenti Linear agli agenti Kilo:

```json
{
  "davide@example.com": "build",
  "marco@example.com": "plan",
  "@example.com": "default-agent"
}
```

- Mapping diretto per email
- Mapping per dominio con `@dominio.com`
- `default` come fallback

## Flusso di lavoro

1. Un issue viene assegnato su Linear
2. Linear invia webhook al servizio
3. Il servizio verifica la firma (se configurata)
4. Il Task Router identifica l'agente dal mapping
5. Il task viene inviato al Kilo Cloud Agent (o accodato se disabilitato)
6. La sessione viene tracciata e resa disponibile via API

## Sviluppo

```bash
# Installa dipendenze dev
pip install pytest pytest-asyncio httpx

# Run tests
pytest tests/

# Run con reload
uvicorn src.main:app --reload
```

## Struttura Progetto

```
linear-kilo-webhook/
├── src/
│   ├── main.py              # FastAPI app
│   ├── config.py            # Configurazione
│   ├── linear/              # Modelli e handler Linear
│   ├── kilo/                # Client Kilo Cloud
│   └── utils/               # Utility
├── tests/                   # Test
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## Stato Cloud Agent

Attualmente il servizio è configurato per:
- ✅ Ricevere webhook da Linear
- ✅ Verificare firme HMAC
- ✅ Smistare task agli agenti configurati
- ⚠️ Inviare a Kilo Cloud Agent (richiede KILO_API_KEY)

Quando `KILO_CLOUD_ENABLED=true` e `KILO_API_KEY` è configurato, i task verranno automaticamente inviati ai Cloud Agent di Kilo.
