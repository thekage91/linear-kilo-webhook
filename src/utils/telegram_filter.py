"""
Telegram Message Filter - User Authorization Middleware

This module filters incoming Telegram messages and only allows
authorized users (specifically user ID 9504807) to interact with the bot.

Usage:
    from telegram_filter import TelegramFilter
    
    # Check if user is authorized
    if not TelegramFilter.is_authorized_user(message_context):
        return "NO_REPLY"  # Silent ignore
"""

import re
from typing import Optional


class TelegramFilter:
    """
    Filters Telegram messages based on user authorization.
    Only allows specific user IDs to interact with the bot.
    """
    
    # Authorized Telegram user IDs (only Davide)
    ALLOWED_USER_IDS = {"9504807"}
    
    @classmethod
    def extract_user_id(cls, message_context: str) -> Optional[str]:
        """
        Extract Telegram user ID from message context.
        
        Telegram messages are formatted as:
        [Telegram Name (@username) id:9504807 +timestamp ...] Message
        
        Args:
            message_context: The full message context/header
            
        Returns:
            User ID string if found, None otherwise
        """
        if not message_context:
            return None
        
        # Pattern to match: id:9504807
        pattern = r'id:(\d+)'
        match = re.search(pattern, message_context)
        
        if match:
            return match.group(1)
        
        return None
    
    @classmethod
    def is_authorized_user(cls, user_id: Optional[str]) -> bool:
        """
        Check if a user ID is authorized.
        
        Args:
            user_id: Telegram user ID string
            
        Returns:
            True if user is authorized, False otherwise
        """
        if not user_id:
            return False
        
        return user_id in cls.ALLOWED_USER_IDS
    
    @classmethod
    def should_process_message(cls, message_context: str) -> tuple[bool, Optional[str]]:
        """
        Determine if a message should be processed.
        
        Args:
            message_context: Full message context from Telegram
            
        Returns:
            Tuple of (should_process, user_id)
        """
        user_id = cls.extract_user_id(message_context)
        
        if not user_id:
            # No user ID found - treat as unauthorized
            return False, None
        
        if cls.is_authorized_user(user_id):
            return True, user_id
        else:
            # Unauthorized user - silently ignore
            return False, user_id
    
    @classmethod
    def get_filter_response(cls, user_id: Optional[str] = None) -> str:
        """
        Get the appropriate response for unauthorized access.
        
        Returns NO_REPLY to silently ignore the message.
        """
        return "NO_REPLY"


# Convenience function for direct usage
def check_authorization(message_context: str) -> tuple[bool, str]:
    """
    Quick check if message should be processed.
    
    Args:
        message_context: The message context string
        
    Returns:
        Tuple of (is_authorized, response)
        If not authorized, response is "NO_REPLY"
    """
    should_process, user_id = TelegramFilter.should_process_message(message_context)
    
    if should_process:
        return True, ""
    else:
        return False, TelegramFilter.get_filter_response(user_id)


# Example usage / Test
if __name__ == "__main__":
    # Test cases
    test_messages = [
        "[Telegram Davide (@thekage91) id:9504807 +5m 2026-02-15 12:57 GMT+1] Test message",
        "[Telegram John Doe (@johndoe) id:12345678 +1m 2026-02-15 12:58 GMT+1] Unauthorized",
        "[Telegram Jane Smith (@jane) id:99999999 +2m 2026-02-15 12:59 GMT+1] Also unauthorized",
        "Invalid message without ID",
    ]
    
    print("Testing Telegram Message Filter:")
    print("=" * 60)
    
    for msg in test_messages:
        user_id = TelegramFilter.extract_user_id(msg)
        is_auth = TelegramFilter.is_authorized_user(user_id)
        should_process, _ = TelegramFilter.should_process_message(msg)
        
        print(f"\nMessage: {msg[:50]}...")
        print(f"  User ID: {user_id}")
        print(f"  Authorized: {is_auth}")
        print(f"  Should Process: {should_process}")
        
        if not should_process:
            print(f"  Response: {TelegramFilter.get_filter_response()}")
