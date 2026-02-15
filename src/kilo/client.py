"""
Kilo Code client for Cloud Agent integration.
Handles session creation, task submission, and status monitoring.
"""
import httpx
from typing import Any

from src.utils.logger import get_logger
from src.config import settings

logger = get_logger()


class KiloCloudClient:
    """Client for Kilo Cloud Agent API."""
    
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or settings.kilo_api_key
        self.base_url = base_url or settings.kilo_cloud_url
        self.enabled = settings.kilo_cloud_enabled
        
        if not self.enabled:
            logger.warning("Kilo Cloud is disabled - tasks will be queued locally")
    
    async def create_session(
        self,
        repo_url: str,
        task: str,
        agent_id: str = "build",
        branch_name: str | None = None,
        base_branch: str = "develop",
    ) -> dict[str, Any]:
        """
        Create a new Cloud Agent session.
        
        Args:
            repo_url: GitHub/GitLab repository URL
            task: Task description/prompt
            agent_id: Kilo agent ID (e.g., 'build', 'plan', 'ask')
            branch_name: Optional custom branch name for the PR
            base_branch: Base branch to create PR from (default: develop)
        
        Returns:
            Session info with ID and status
        """
        if not self.enabled or not self.api_key:
            logger.info(
                "Cloud agent disabled, returning mock session",
                repo=repo_url,
                agent=agent_id,
                branch=branch_name,
            )
            return {
                "session_id": f"local-{hash(task) & 0xFFFFFFFF:08x}",
                "status": "queued",
                "mode": "local",
                "branch": branch_name,
            }
        
        # Enhance prompt with branch and PR instructions
        enhanced_task = task
        if branch_name:
            enhanced_task += f"\n\nCreate a new branch named '{branch_name}' for this work."
        enhanced_task += f"\n\nWhen complete, create a pull request targeting the '{base_branch}' branch."
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/v1/sessions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "repository": repo_url,
                        "prompt": task,
                        "agent": agent_id,
                        "auto": True,  # Auto mode for CI/CD
                    },
                    timeout=30.0,
                )
                response.raise_for_status()
                
                data = response.json()
                logger.info(
                    "Cloud session created",
                    session_id=data.get("id"),
                    repo=repo_url,
                    agent=agent_id,
                )
                
                return {
                    "session_id": data.get("id"),
                    "status": data.get("status", "created"),
                    "url": f"{self.base_url}/sessions/{data.get('id')}",
                    "mode": "cloud",
                }
                
            except httpx.HTTPStatusError as e:
                logger.error(
                    "Failed to create Cloud session",
                    status=e.response.status_code,
                    error=e.response.text,
                )
                raise
            except Exception as e:
                logger.error("Unexpected error creating session", error=str(e))
                raise
    
    async def get_session_status(self, session_id: str) -> dict[str, Any]:
        """Get status of a Cloud Agent session."""
        if not self.enabled or session_id.startswith("local-"):
            return {
                "session_id": session_id,
                "status": "pending",
                "mode": "local",
            }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/v1/sessions/{session_id}",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()


class AgentRouter:
    """
    Routes tasks to Kilo Cloud Agents.
    Manages agent selection, session tracking, and task queuing.
    """
    
    def __init__(self):
        self.client = KiloCloudClient()
        self.active_sessions: dict[str, dict] = {}  # Track active sessions
        logger.info("Agent router initialized")
    
    async def submit_task(
        self,
        agent_id: str,
        issue_data: dict[str, Any],
        repo_url: str | None = None,
    ) -> dict[str, Any]:
        """
        Submit a task to a Kilo agent.
        
        Args:
            agent_id: Target Kilo agent ID
            issue_data: Linear issue summary
            repo_url: Optional repository URL
        
        Returns:
            Submission result with session info
        """
        # Build task prompt from issue data
        task_prompt = self._build_task_prompt(issue_data)
        
        logger.info(
            "Submitting task to agent",
            agent=agent_id,
            issue=issue_data.get("identifier"),
        )
        
        # Default repo if not provided
        repo = repo_url or self._get_repo_from_issue(issue_data)
        
        # Generate branch name with Linear identifier for tracking
        branch_name = self._generate_branch_name(issue_data)
        base_branch = settings.default_base_branch
        
        try:
            # Create Cloud Agent session
            session = await self.client.create_session(
                repo_url=repo,
                task=task_prompt,
                agent_id=agent_id,
                branch_name=branch_name,
                base_branch=base_branch,
            )
            
            # Track the session
            self.active_sessions[session["session_id"]] = {
                "agent_id": agent_id,
                "issue": issue_data,
                "branch": branch_name,
                "base_branch": base_branch,
                "repo": repo,
                "created_at": "now",  # TODO: use proper timestamp
            }
            
            return {
                "success": True,
                "session": session,
                "agent_id": agent_id,
                "issue": issue_data,
            }
            
        except Exception as e:
            logger.error("Failed to submit task", error=str(e))
            return {
                "success": False,
                "error": str(e),
                "agent_id": agent_id,
                "issue": issue_data,
            }
    
    def _build_task_prompt(self, issue_data: dict[str, Any]) -> str:
        """Build a task prompt from Linear issue data."""
        title = issue_data.get("title", "")
        description = issue_data.get("description", "")
        identifier = issue_data.get("identifier", "")
        url = issue_data.get("url", "")
        
        prompt_parts = [
            f"Task from Linear: {identifier}",
            f"Title: {title}",
        ]
        
        if description:
            prompt_parts.append(f"Description:\n{description}")
        
        if url:
            prompt_parts.append(f"Linear URL: {url}")
        
        prompt_parts.append("\nPlease analyze this task and implement the necessary changes.")
        
        return "\n\n".join(prompt_parts)
    
    def _get_repo_from_issue(self, issue_data: dict[str, Any]) -> str:
        """Get repository URL from settings."""
        return settings.default_repo_url
    
    def _generate_branch_name(self, issue_data: dict[str, Any]) -> str:
        """
        Generate a branch name that includes Linear issue identifier.
        Format: linear/TEAM-123-short-description
        
        This allows Linear to track the PR via branch name.
        """
        import re
        
        identifier = issue_data.get("identifier", "UNKNOWN")
        title = issue_data.get("title", "")
        
        # Sanitize title for branch name
        # Remove special chars, limit length, replace spaces with hyphens
        safe_title = re.sub(r'[^\w\s-]', '', title.lower())
        safe_title = re.sub(r'[-\s]+', '-', safe_title)
        safe_title = safe_title.strip('-')[:30]  # Limit to 30 chars
        
        # Format: linear/TEAM-123-short-desc
        branch_name = f"linear/{identifier.lower()}-{safe_title}"
        
        return branch_name
    
    def get_active_sessions(self) -> dict[str, dict]:
        """Get all active sessions."""
        return self.active_sessions.copy()
    
    async def check_session_status(self, session_id: str) -> dict[str, Any]:
        """Check the status of a specific session."""
        return await self.client.get_session_status(session_id)
