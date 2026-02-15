"""
Tests for Linear webhook models.
"""
import pytest
from src.linear.models import (
    LinearWebhookRequest,
    LinearWebhookType,
    LinearAction,
    LinearIssueData,
    LinearUser,
)


class TestLinearWebhookRequest:
    """Test Linear webhook request parsing."""
    
    def test_issue_assignment_detection(self):
        """Test detection of issue assignment events."""
        payload = {
            "action": "update",
            "type": "Issue",
            "data": {
                "id": "issue-123",
                "identifier": "TEAM-123",
                "title": "Test Issue",
                "assignee": {
                    "id": "user-456",
                    "name": "John Doe",
                    "email": "john@example.com",
                },
            },
        }
        
        webhook = LinearWebhookRequest(**payload)
        assert webhook.is_issue_assigned() is True
        assert webhook.get_assignee_email() == "john@example.com"
    
    def test_non_issue_ignored(self):
        """Test that non-issue webhooks are ignored."""
        payload = {
            "action": "create",
            "type": "Comment",
            "data": {"id": "comment-123"},
        }
        
        webhook = LinearWebhookRequest(**payload)
        assert webhook.is_issue_assigned() is False
    
    def test_unassigned_issue_ignored(self):
        """Test that unassigned issues are ignored."""
        payload = {
            "action": "create",
            "type": "Issue",
            "data": {
                "id": "issue-123",
                "identifier": "TEAM-123",
                "title": "Test Issue",
                "assignee": None,
            },
        }
        
        webhook = LinearWebhookRequest(**payload)
        assert webhook.is_issue_assigned() is False


class TestTaskRouter:
    """Test task routing logic."""
    
    def test_email_based_routing(self):
        """Test routing based on email address."""
        from src.linear.webhook_handler import TaskRouter
        
        mapping = {
            "john@example.com": "agent-john",
            "jane@example.com": "agent-jane",
        }
        router = TaskRouter(mapping)
        
        assert router.get_agent_for_assignee("john@example.com") == "agent-john"
        assert router.get_agent_for_assignee("jane@example.com") == "agent-jane"
        assert router.get_agent_for_assignee("unknown@example.com") is None
    
    def test_domain_based_routing(self):
        """Test routing based on email domain."""
        from src.linear.webhook_handler import TaskRouter
        
        mapping = {
            "@example.com": "default-agent",
        }
        router = TaskRouter(mapping)
        
        assert router.get_agent_for_assignee("anyone@example.com") == "default-agent"
        assert router.get_agent_for_assignee("other@different.com") is None
