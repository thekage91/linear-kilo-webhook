"""
Telegram notification utilities for webhook events.
"""
import os
from src.utils.logger import get_logger

logger = get_logger()


class TelegramNotifier:
    """Sends notifications to Telegram when webhook events occur."""
    
    def __init__(self):
        # Default to the main user's ID
        self.telegram_user_id = os.getenv("NOTIFICATION_USER_ID", "9504807")
        self.enabled = os.getenv("TELEGRAM_NOTIFICATIONS_ENABLED", "true").lower() == "true"
    
    async def notify_issue_assigned(self, issue_data: dict, agent_id: str, branch_name: str = None, repo: str = None) -> None:
        """
        Send notification when an issue is assigned and routed to an agent.
        
        Args:
            issue_data: Linear issue information
            agent_id: Kilo agent ID that will handle the task
            branch_name: Optional branch name that will be created
            repo: Optional repository URL
        """
        if not self.enabled:
            logger.debug("Telegram notifications disabled")
            return
        
        issue_id = issue_data.get("identifier", "Unknown")
        title = issue_data.get("title", "No title")
        assignee = issue_data.get("assignee", "Unknown")
        
        message = f"""🎯 **Nuovo Task da Linear**

📋 **Issue:** {issue_id}
📝 **Titolo:** {title}
👤 **Assegnato a:** {assignee}
🤖 **Agente Kilo:** {agent_id}"""
        
        if repo:
            repo_name = repo.split('/')[-1] if '/' in repo else repo
            message += f"\n📁 **Repository:** {repo_name}"
        
        if branch_name:
            message += f"\n🌿 **Branch:** `{branch_name}`"
        
        message += "\n\n⏳ Sto avviando il Cloud Agent e iniziando a processare l'attività..."
        
        logger.info("Sending Telegram notification", issue=issue_id, agent=agent_id, branch=branch_name)
        
        # This will be called by the main webhook handler
        # The actual message sending happens through OpenClaw's message tool
        return {
            "user_id": self.telegram_user_id,
            "message": message,
        }
    
    async def notify_task_completed(self, issue_id: str, agent_id: str, status: str) -> None:
        """Send notification when a task is completed."""
        if not self.enabled:
            return
        
        message = f"""✅ **Task Completato**

📋 **Issue:** {issue_id}
🤖 **Agente:** {agent_id}
📊 **Stato:** {status}

Il task è stato elaborato con successo!"""
        
        return {
            "user_id": self.telegram_user_id,
            "message": message,
        }
    
    async def notify_error(self, issue_id: str, error: str) -> None:
        """Send notification when an error occurs."""
        if not self.enabled:
            return
        
        message = f"""⚠️ **Errore nel Processamento**

📋 **Issue:** {issue_id}
❌ **Errore:** {error}

Si è verificato un problema durante l'elaborazione del task."""
        
        return {
            "user_id": self.telegram_user_id,
            "message": message,
        }


# Global instance
telegram_notifier = TelegramNotifier()
