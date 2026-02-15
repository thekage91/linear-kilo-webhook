"""
Pydantic models for Linear webhook events.
Reference: https://developers.linear.app/docs/graphql/webhooks
"""
from pydantic import BaseModel, Field
from typing import Literal, Any
from datetime import datetime
from enum import Enum


class LinearAction(str, Enum):
    """Linear webhook actions."""
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    REMOVE = "remove"


class LinearState(str, Enum):
    """Issue states in Linear."""
    BACKLOG = "backlog"
    UNSTARTED = "unstarted"
    STARTED = "started"
    COMPLETED = "completed"
    CANCELED = "canceled"


class LinearUser(BaseModel):
    """Linear user data."""
    id: str
    name: str
    email: str


class LinearIssueData(BaseModel):
    """Issue data from Linear webhook."""
    id: str
    identifier: str = Field(alias="identifier")
    title: str
    description: str | None = None
    state: dict[str, Any] | None = None
    assignee: LinearUser | None = None
    creator: LinearUser | None = None
    priority: int | None = None
    labels: list[dict[str, Any]] | None = None
    project: dict[str, Any] | None = None
    team: dict[str, Any] | None = None
    url: str | None = None
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)
    
    class Config:
        populate_by_name = True


class LinearWebhookType(str, Enum):
    """Types of Linear webhooks."""
    ISSUE = "Issue"
    COMMENT = "Comment"
    PROJECT = "Project"
    CYCLE = "Cycle"


class LinearWebhookPayload(BaseModel):
    """Linear webhook payload structure."""
    action: LinearAction
    type: LinearWebhookType
    data: LinearIssueData | dict[str, Any]
    url: str | None = None
    created_at: datetime | None = Field(alias="createdAt", default=None)
    
    class Config:
        populate_by_name = True


class LinearWebhookRequest(BaseModel):
    """Full Linear webhook request."""
    # Linear webhooks send the payload directly or wrapped
    action: LinearAction | None = None
    type: LinearWebhookType | None = None
    data: LinearIssueData | dict[str, Any] | None = None
    
    def is_issue_assigned(self) -> bool:
        """Check if this is an issue assignment event."""
        if self.type != LinearWebhookType.ISSUE:
            return False
        if self.action not in [LinearAction.CREATE, LinearAction.UPDATE]:
            return False
        if not isinstance(self.data, LinearIssueData):
            return False
        return self.data.assignee is not None
    
    def get_assignee_email(self) -> str | None:
        """Get the assignee email from the issue."""
        if isinstance(self.data, LinearIssueData) and self.data.assignee:
            return self.data.assignee.email
        return None
    
    def get_issue_summary(self) -> dict[str, Any]:
        """Get a summary of the issue for routing."""
        if not isinstance(self.data, LinearIssueData):
            return {}
        
        return {
            "id": self.data.id,
            "identifier": self.data.identifier,
            "title": self.data.title,
            "description": self.data.description,
            "assignee": self.data.assignee.email if self.data.assignee else None,
            "url": self.data.url,
            "priority": self.data.priority,
        }
