#!/usr/bin/env python3
"""
OpenClaw Telegram Authorization Filter

Questo script mostra come implementare il filtro utente nel contesto OpenClaw.
L'idea è che all'inizio di ogni conversazione Telegram, verifichiamo l'utente.

In un sistema reale OpenClaw, questo verrebbe eseguito automaticamente
dal gateway prima di inoltrare il messaggio all'agente.
"""

import sys
import re


def extract_telegram_user_id(context_line: str) -> str | None:
    """Estrae l'ID utente dal contesto Telegram."""
    match = re.search(r'id:(\d+)', context_line)
    return match.group(1) if match else None


def is_authorized(user_id: str) -> bool:
    """Verifica se l'utente è autorizzato."""
    # Solo l'utente 9504807 (Davide) è autorizzato
    return user_id == "9504807"


def filter_message(message_context: str) -> bool:
    """
    Filtra il messaggio. Ritorna True se autorizzato, False altrimenti.
    
    Usage:
        # All'inizio del processing di ogni messaggio
        if not filter_message(message_context):
            print("NO_REPLY")  # O return NO_REPLY
            sys.exit(0)
    """
    user_id = extract_telegram_user_id(message_context)
    
    if not user_id:
        print("⚠️  No user ID found in message context")
        return False
    
    if is_authorized(user_id):
        print(f"✅ Authorized user: {user_id}")
        return True
    else:
        print(f"❌ Unauthorized user: {user_id} - Access denied")
        return False


if __name__ == "__main__":
    # Test con vari messaggi
    test_cases = [
        ("[Telegram Davide (@thekage91) id:9504807 +5m] Ciao", True),
        ("[Telegram Hacker (@badguy) id:12345678 +1m] Attacco!", False),
        ("[Telegram Unknown id:99999999 +2m] Spam", False),
        ("Messaggio senza ID", False),
    ]
    
    print("🧪 Testing Telegram Authorization Filter\n")
    print("=" * 60)
    
    for context, expected in test_cases:
        result = filter_message(context)
        status = "✅ PASS" if result == expected else "❌ FAIL"
        print(f"\n{status}")
        print(f"   Context: {context[:40]}...")
        print(f"   Expected: {expected}, Got: {result}")
    
    print("\n" + "=" * 60)
    print("\n🔒 Only user 9504807 is authorized to use this bot.")
    print("   All other users will receive NO_REPLY (silence).")
