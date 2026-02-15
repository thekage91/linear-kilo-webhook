"""
Telegram user authorization utilities.
"""
from src.config import settings
from src.utils.logger import get_logger

logger = get_logger()


class TelegramAuth:
    """Handles Telegram user authorization."""
    
    def __init__(self):
        self._allowed_users = self._parse_allowed_users()
        if self._allowed_users:
            logger.info(
                "Telegram user restriction enabled",
                allowed_count=len(self._allowed_users),
                allowed_users=list(self._allowed_users)
            )
        else:
            logger.info("Telegram user restriction disabled - all users allowed")
    
    def _parse_allowed_users(self) -> set[str]:
        """Parse comma-separated list of allowed user IDs."""
        if not settings.telegram_allowed_users:
            return set()
        
        # Parse "9504807,12345678" -> {"9504807", "12345678"}
        users = set()
        for user_id in settings.telegram_allowed_users.split(","):
            user_id = user_id.strip()
            if user_id:
                users.add(user_id)
        return users
    
    def is_user_allowed(self, user_id: str | int | None) -> bool:
        """
        Check if a Telegram user is allowed to interact with the bot.
        
        Args:
            user_id: Telegram user ID (string or int)
        
        Returns:
            True if user is allowed or if no restrictions are configured
        """
        # If no restrictions configured, allow all
        if not self._allowed_users:
            return True
        
        # If no user_id provided, deny
        if user_id is None:
            logger.warning("No user_id provided, denying access")
            return False
        
        # Convert to string for comparison
        user_id_str = str(user_id)
        
        if user_id_str in self._allowed_users:
            logger.debug("User authorized", user_id=user_id_str)
            return True
        else:
            logger.warning(
                "Unauthorized user attempted access",
                user_id=user_id_str,
                allowed_users=list(self._allowed_users)
            )
            return False
    
    def require_auth(self, user_id: str | int | None) -> bool:
        """
        Require authentication for a user. Raises exception if not allowed.
        
        Returns:
            True if authorized
        
        Raises:
            PermissionError: If user is not authorized
        """
        if not self.is_user_allowed(user_id):
            raise PermissionError(
                f"User {user_id} is not authorized to use this bot. "
                f"Contact the administrator to request access."
            )
        return True
    
    def get_allowed_users(self) -> list[str]:
        """Get list of allowed user IDs."""
        return sorted(list(self._allowed_users))


# Global instance
telegram_auth = TelegramAuth()
