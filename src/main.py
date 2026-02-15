"""
FastAPI application for Linear → Kilo webhook service.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, Depends, Header
from fastapi.responses import JSONResponse

from src.config import settings
from src.utils.logger import configure_logging, get_logger
from src.linear.webhook_handler import LinearWebhookHandler, TaskRouter
from src.kilo.client import AgentRouter
from src.utils.telegram_notifier import telegram_notifier

# Configure logging
configure_logging(debug=settings.debug)
logger = get_logger()


# Global handlers (initialized in lifespan)
webhook_handler: LinearWebhookHandler | None = None
task_router: TaskRouter | None = None
agent_router: AgentRouter | None = None


def verify_admin_auth(x_api_key: str | None = Header(None)):
    """Verify admin API key for protected endpoints."""
    if not settings.admin_api_key:
        # If no admin key is configured, allow access (for development)
        return True
    
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    
    import hmac
    if not hmac.compare_digest(x_api_key, settings.admin_api_key):
        raise HTTPException(status_code=403, detail="Invalid API key")
    
    return True


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    global webhook_handler, task_router, agent_router
    
    # Startup
    logger.info(
        "Starting Linear Kilo Webhook Service",
        app_name=settings.app_name,
        debug=settings.debug,
    )
    
    webhook_handler = LinearWebhookHandler(
        webhook_secret=settings.linear_webhook_secret,
        bearer_token=settings.webhook_bearer_token,
    )
    task_router = TaskRouter(agent_mapping=settings.agent_mapping)
    agent_router = AgentRouter()
    
    logger.info("Service initialized and ready")
    
    yield
    
    # Shutdown
    logger.info("Shutting down service")


# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    description="Webhook service that routes Linear tasks to Kilo Cloud Agents",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": settings.app_name,
        "version": "0.1.0",
    }


@app.get("/ready")
async def readiness_check() -> dict:
    """Readiness check for orchestration."""
    if webhook_handler is None or task_router is None or agent_router is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    
    return {
        "status": "ready",
        "handlers": {
            "webhook": webhook_handler is not None,
            "router": task_router is not None,
            "agent": agent_router is not None,
        },
    }


@app.post("/webhook/linear")
async def linear_webhook(request: Request) -> JSONResponse:
    """
    Receive webhooks from Linear.
    
    This endpoint receives issue assignment events from Linear
    and routes them to the appropriate Kilo Cloud Agent.
    """
    if webhook_handler is None or task_router is None or agent_router is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    
    # Read raw body for signature verification
    body = await request.body()
    
    # Verify Bearer token (if required or configured)
    if settings.webhook_auth_required or settings.webhook_bearer_token:
        is_token_valid = await webhook_handler.verify_bearer_token(request)
        if not is_token_valid:
            logger.warning("Bearer token verification failed")
            raise HTTPException(status_code=401, detail="Invalid or missing bearer token")
    
    # Verify webhook signature (Linear HMAC)
    is_valid = await webhook_handler.verify_signature(request, body)
    if not is_valid:
        logger.warning("Webhook signature verification failed")
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    # Parse and validate payload
    webhook_data = await webhook_handler.parse_payload(body)
    
    # Check if we should process this event
    should_process, reason = webhook_handler.should_process(webhook_data)
    
    if not should_process:
        logger.info(f"Webhook ignored: {reason}")
        return JSONResponse(
            content={
                "status": "ignored",
                "reason": reason,
            },
            status_code=200,
        )
    
    # Route the task to an agent
    routing_result = task_router.route_task(webhook_data)
    
    if not routing_result.get("routed"):
        logger.warning(f"Task routing failed: {routing_result.get('reason')}")
        return JSONResponse(
            content={
                "status": "not_routed",
                "reason": routing_result.get("reason"),
            },
            status_code=200,
        )
    
    # Submit to Kilo Cloud Agent
    agent_id = routing_result["agent_id"]
    issue_data = routing_result["issue"]
    
    submission = await agent_router.submit_task(
        agent_id=agent_id,
        issue_data=issue_data,
    )
    
    if submission.get("success"):
        logger.info(
            "Task successfully submitted to Kilo",
            session_id=submission["session"].get("session_id"),
            agent=agent_id,
        )
        
        # Send Telegram notification to Davide
        try:
            # Get branch info from active sessions
            session_id = submission["session"].get("session_id")
            session_info = agent_router.active_sessions.get(session_id, {})
            branch_name = session_info.get("branch")
            repo = session_info.get("repo")
            
            await telegram_notifier.notify_issue_assigned(
                issue_data, 
                agent_id,
                branch_name=branch_name,
                repo=repo
            )
            logger.info("Telegram notification sent", issue=issue_data.get("identifier"))
        except Exception as e:
            logger.error("Failed to send Telegram notification", error=str(e))
        
        return JSONResponse(
            content={
                "status": "routed",
                "agent_id": agent_id,
                "session": submission["session"],
                "issue": issue_data,
                "branch": branch_name,
            },
            status_code=202,  # Accepted for processing
        )
    else:
        logger.error(
            "Failed to submit task to Kilo",
            error=submission.get("error"),
            agent=agent_id,
        )
        
        return JSONResponse(
            content={
                "status": "error",
                "error": submission.get("error"),
                "agent_id": agent_id,
            },
            status_code=500,
        )


@app.get("/sessions")
async def list_sessions(auth: bool = Depends(verify_admin_auth)) -> dict:
    """List all active Kilo Cloud Agent sessions."""
    if agent_router is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    
    sessions = agent_router.get_active_sessions()
    return {
        "sessions": sessions,
        "count": len(sessions),
    }


@app.get("/sessions/{session_id}")
async def get_session(session_id: str, auth: bool = Depends(verify_admin_auth)) -> dict:
    """Get details of a specific Kilo Cloud Agent session."""
    if agent_router is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    
    status = await agent_router.check_session_status(session_id)
    return status


@app.get("/config")
async def get_config(auth: bool = Depends(verify_admin_auth)) -> dict:
    """Get current service configuration (excludes secrets)."""
    return {
        "app_name": settings.app_name,
        "debug": settings.debug,
        "host": settings.host,
        "port": settings.port,
        "kilo_cloud_enabled": settings.kilo_cloud_enabled,
        "kilo_cloud_url": settings.kilo_cloud_url,
        "agent_mapping_count": len(settings.agent_mapping),
        "linear_configured": settings.linear_api_key is not None,
        "webhook_auth_required": settings.webhook_auth_required,
        "webhook_bearer_configured": settings.webhook_bearer_token is not None,
        "admin_auth_configured": settings.admin_api_key is not None,
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
