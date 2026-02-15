# Telegram Bot User Restriction

## Overview

Questo sistema restringe l'accesso al bot Telegram **solo all'utente autorizzato** (ID: 9504807).

## Come Funziona

### Pattern di Matching

I messaggi Telegram arrivano nel formato:
```
[Telegram Davide (@thekage91) id:9504807 +11m 2026-02-15 12:57 GMT+1] Messaggio
```

Il filtro estrae l'ID utente con regex: `id:(\d+)`

### Comportamento

| Utente | ID | Esito |
|--------|-----|-------|
| Davide | 9504807 | ✅ Messaggio processato |
| Altri | Qualsiasi altro | ❌ NO_REPLY (silenzio assoluto) |
| Sconosciuto | Nessun ID | ❌ NO_REPLY (silenzio assoluto) |

## Implementazione

### Opzione 1: Filtro a Livello di Codice (Consigliata)

Aggiungi questo all'inizio di ogni handler di messaggi:

```python
from src.utils.telegram_filter import TelegramFilter

# All'inizio della funzione che gestisce i messaggi
def handle_message(message_context: str, message_text: str):
    should_process, user_id = TelegramFilter.should_process_message(message_context)
    
    if not should_process:
        # Silenziosamente ignora il messaggio
        return "NO_REPLY"
    
    # Procedi con il processing per l'utente autorizzato
    ...
```

### Opzione 2: Decorator Pattern

```python
from functools import wraps
from src.utils.telegram_filter import TelegramFilter

def require_auth(func):
    @wraps(func)
    def wrapper(message_context, *args, **kwargs):
        should_process, user_id = TelegramFilter.should_process_message(message_context)
        if not should_process:
            return "NO_REPLY"
        return func(message_context, *args, **kwargs)
    return wrapper

@require_auth
def process_message(message_context, message_text):
    # Solo utenti autorizzati arrivano qui
    pass
```

## File Creati

- `src/utils/telegram_filter.py` - Filtro di autorizzazione

## Configurazione

Per modificare gli utenti autorizzati, edita `TelegramFilter.ALLOWED_USER_IDS`:

```python
class TelegramFilter:
    ALLOWED_USER_IDS = {"9504807", "12345678"}  # Aggiungi altri ID se necessario
```

## Sicurezza

⚠️ **Nota Importante**: Questo filtro funziona a livello di applicazione. Se qualcuno trova il bot su Telegram, può comunque:
- Vedere il bot nella ricerca
- Inviare messaggi (che verranno silenziosamente ignorati)
- Non ricevere alcuna risposta (sembra un bot "morto")

Per maggiore sicurezza, considera anche:
1. Cambiare username del bot in BotFather (meno descrittivo)
2. Disabilitare l'aggiunta a gruppi (BotFather → Group Privacy)
3. Non condividere mai il link/username del bot pubblicamente

## Test

Per testare il filtro:

```bash
cd ~/.openclaw/workspace/linear-kilo-webhook
source venv/bin/activate
python src/utils/telegram_filter.py
```

Output atteso:
```
Testing Telegram Message Filter:
============================================================

Message: [Telegram Davide (@thekage91) id:9504807 +5m ...
  User ID: 9504807
  Authorized: True
  Should Process: True

Message: [Telegram John Doe (@johndoe) id:12345678 +1m ...
  User ID: 12345678
  Authorized: False
  Should Process: False
  Response: NO_REPLY
...
```
