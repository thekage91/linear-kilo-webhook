"""
Linear webhook handler with signature verification.
"""
import hmac
import hashlib
from typing import Any

from fastapi import HTTPException, Request
from pydantic import ValidationError

from src.linear.models import LinearWebhookRequest
from src.utils.logger import get_logger

logger = get_logger()


class LinearWebhookHandler:
    """Handler for Linear webhooks with HMAC and Bearer token verification."""
    
    def __init__(self, webhook_secret: str | None = None, bearer_token: str | None = None):
        self.webhook_secret = webhook_secret
        self.bearer_token = bearer_token
    
    async def verify_signature(self, request: Request, body: bytes) -> bool:
        """Verify Linear webhook signature if secret is configured."""
        if not self.webhook_secret:
            logger.debug("No webhook secret configured, skipping verification")
            return True
        
        signature = request.headers.get("linear-signature")
        if not signature:
            logger.warning("Missing linear-signature header")
            return False
        
        expected = hmac.new(
            self.webhook_secret.encode(),
            body,
            hashlib.sha256
        ).hexdigest()
        
        if not hmac.compare_digest(signature, expected):
            logger.warning("Invalid webhook signature")
            return False
        
        return True
    
    async def verify_bearer_token(self, request: Request) -> bool:
        """Verify Bearer token if configured."""
        if not self.bearer_token:
            logger.debug("No bearer token configured, skipping verification")
            return True
        
        auth_header = request.headers.get("authorization")
        if not auth_header:
            logger.warning("Missing Authorization header")
            return False
        
        # Parse Bearer token
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            logger.warning("Invalid Authorization header format")
            return False
        
        token = parts[1]
        if not hmac.compare_digest(token, self.bearer_token):
            logger.warning("Invalid bearer token")
            return False
        
        return True
    
    async def parse_payload(self, body: bytes) -> LinearWebhookRequest:
        """Parse and validate webhook payload."""
        import json
        
        try:
            data = json.loads(body)
            logger.debug("Received webhook payload", payload=data)
            
            # Linear can send payload directly or nested
            webhook_data = LinearWebhookRequest(**data)
            return webhook_data
            
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in webhook payload", error=str(e))
            raise HTTPException(status_code=400, detail="Invalid JSON")
        except ValidationError as e:
            logger.error("Invalid webhook payload structure", error=str(e))
            raise HTTPException(status_code=400, detail="Invalid payload structure")
    
    def should_process(self, webhook: LinearWebhookRequest) -> tuple[bool, str]:
        """
        Determine if the webhook should be processed.
        Returns (should_process, reason).
        """
        # Only process issue webhooks
        if webhook.type != "Issue":
            return False, f"Ignoring non-issue webhook: {webhook.type}"
        
        # Only process create/update actions
        if webhook.action not in ["create", "update"]:
            return False, f"Ignoring action: {webhook.action}"
        
        # Check if assigned to someone
        if not webhook.is_issue_assigned():
            return False, "Issue not assigned to anyone"
        
        return True, "Processing assigned issue"


class TaskRouter:
    """Routes Linear tasks to appropriate Kilo agents."""
    
    def __init__(self, agent_mapping: dict[str, str]):
        """
        Initialize router with agent mapping.
        
        Args:
            agent_mapping: Dict mapping Linear user emails to Kilo agent IDs
        """
        self.agent_mapping = agent_mapping
        logger.info("Task router initialized", mappings=len(agent_mapping))
    
    def get_agent_for_assignee(self, assignee_email: str) -> str | None:
        """
        Get the Kilo agent ID for a Linear assignee.
        Returns None if no mapping exists.
        """
        # Direct email mapping
        if assignee_email in self.agent_mapping:
            return self.agent_mapping[assignee_email]
        
        # Try domain-based routing (e.g., "@company.com" -> "default-agent")
        domain = assignee_email.split("@")[-1]
        domain_key = f"@{domain}"
        if domain_key in self.agent_mapping:
            return self.agent_mapping[domain_key]
        
        # Default agent
        return self.agent_mapping.get("default")
    
    def route_task(self, webhook: LinearWebhookRequest) -> dict[str, Any]:
        """
        Route a task to the appropriate agent.
        Returns routing information.
        """
        assignee_email = webhook.get_assignee_email()
        if not assignee_email:
            logger.warning("Cannot route: no assignee email")
            return {
                "routed": False,
                "reason": "No assignee email",
            }
        
        agent_id = self.get_agent_for_assignee(assignee_email)
        if not agent_id:
            logger.warning(
                "No agent mapping for assignee",
                email=assignee_email
            )
            return {
                "routed": False,
                "reason": f"No agent mapping for {assignee_email}",
                "assignee": assignee_email,
            }
        
        issue_summary = webhook.get_issue_summary()
        
        logger.info(
            "Task routed to agent",
            assignee=assignee_email,
            agent=agent_id,
            issue=issue_summary.get("identifier"),
        )
        
        return {
            "routed": True,
            "agent_id": agent_id,
            "assignee": assignee_email,
            "issue": issue_summary,
            "routing_method": "email_direct" if assignee_email in self.agent_mapping else "domain_default",
        }
