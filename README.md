# Linear → Kilo Webhook Service

Servizio webhook che riceve task assegnati da Linear e li smista agli agenti Kilo Code.

## Architettura

```
Linear Webhook → FastAPI Server → Agent Router → Kilo Cloud Agent
```

## Requisiti

- Python 3.11+
- Linear API Key
- Kilo Code CLI configurato

## Installazione

```bash
pip install -r requirements.txt
cp .env.example .env
# Modifica .env con le tue credenziali
```

## Avvio

```bash
uvicorn src.main:app --reload --port 8000
```

## Endpoint Webhook

- `POST /webhook/linear` - Riceve eventi da Linear

## Struttura Progetto

```
linear-kilo-webhook/
├── src/
│   ├── main.py              # Entry point FastAPI
│   ├── config.py            # Configurazione
│   ├── linear/              # Gestione Linear
│   │   ├── webhook_handler.py
│   │   └── models.py
│   ├── kilo/                # Gestione Kilo
│   │   ├── client.py
│   │   └── agent_router.py
│   └── utils/               # Utility
│       └── logger.py
├── tests/
├── requirements.txt
└── .env.example
```
