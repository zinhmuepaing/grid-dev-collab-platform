# Grid — Developer Collaboration Platform

#### Video Demo: https://youtu.be/aGGeS-oXjd0

#### Description:

Grid is a comprehensive platform designed to eliminate the friction of finding reliable, technically compatible teammates for hackathons and side projects. Built as a full-stack web application, it serves students and innovators by connecting them based on complementary skills, overlapping availability, and shared interest in hackathon events. The platform features dual OAuth authentication (GitHub and Google), detailed user profiles with skill assessments and availability matrices, automated hackathon data scraping, intelligent matchmaking algorithms, a mutual matching system with notifications, real-time messaging, and team formation with Discord workspace generation.

The application is constructed using a modern yet accessible tech stack: Python with the Flask framework for the backend, vanilla HTML/CSS/JavaScript for the frontend (no build tools required), and SQLite for the database. This choice of technologies ensures simplicity in development and deployment while maintaining robust functionality. The frontend employs a dark-themed design inspired by GitHub's developer aesthetic, using native ES modules for clean, modular JavaScript code. The backend follows a blueprint architecture, separating concerns into distinct modules for authentication, user management, events, matchmaking, messaging, teams, and scraping.

Key features include seamless OAuth integration for user authentication and profile data, a comprehensive onboarding process where users select their technical skills and mark their weekly availability in a visual 7×24 grid, and automatic scraping of hackathon events from platforms like Unstop. The core innovation lies in the matchmaking engine, which uses a sophisticated algorithm combining availability overlap (measured via Jaccard similarity) and skill complementarity to rank potential teammates. Users can search for teammates either by event interest or by desired skills, receiving match scores that help them make informed decisions.

A standout feature is the mutual matching system, where users can "like" each other on profiles or within event contexts. When two users mutually like each other, both receive instant notifications and can start conversations. The platform also includes real-time messaging with short-polling, team formation with invite management, and automated Discord workspace creation for successful teams. Communication is facilitated through a messaging system that supports direct conversations and system notifications, while team formation allows users to create teams, send invites, and generate private Discord channels for collaboration.

The platform also includes responsive design elements and a custom 404 error page for a polished user experience.

## Project Structure and File Explanations

The project follows a clean, organized structure with clear separation of concerns:

- **app.py**: The main Flask application factory that initializes the app, registers all blueprints, and defines page routes. It serves as the entry point for the web server.

- **config.py**: Handles loading environment variables from a .env file, including sensitive information like OAuth credentials, API tokens, and database paths.

- **db.py**: Provides SQLite database connection management with helper functions for getting database connections, closing them, and initializing the database schema.

- **schema.sql**: Contains the complete SQLite database schema, including all tables for users, skills, availability, events, messages, teams, and their relationships. It uses WAL mode for concurrent reads and foreign key constraints for data integrity.

- **seed_skills.sql**: Pre-populates the skills table with common technical skills like Python, React, JavaScript, etc.

- **matcher_engine.py**: Implements the core matchmaking algorithms as pure functions. Includes availability overlap calculation using Jaccard similarity and skill complementarity scoring, combined into a final match score.

- **scrape_and_seed.py**: Handles scraping hackathon data from Unstop's API, downloading event images, and seeding the events table with deduplication logic.

- **requirements.txt**: Lists all Python dependencies including Flask, requests, python-dotenv, and other libraries needed for the project.

The **routes/** directory contains Flask blueprints for different API endpoints:
- **auth.py**: Manages both GitHub and Google OAuth flows, including login redirects, callback handling, and session management.
- **api_users.py**: Handles user profile operations, skills management, and availability matrix updates.
- **api_events.py**: Manages hackathon events, user interest toggling, and event browsing with filtering.
- **api_match.py**: Provides matchmaking endpoints for both event-first and teammate-first searches.
- **api_messages.py**: Implements messaging functionality including conversations, sending messages, and unread count polling.
- **api_teams.py**: Handles team creation, member management, invites, and Discord workspace generation.
- **api_likes.py**: Manages the mutual matching system, including liking/unliking users, checking like status, and retrieving mutual matches.
- **api_scraper.py**: Receives webhooks from Apify for hackathon data ingestion.

The **static/** directory contains frontend assets:
- **css/**: Modular CSS files including variables, reset, typography, layout, and component-specific styles for a cohesive dark theme.
- **js/**: Vanilla JavaScript modules for API communication, matrix interaction, skill selection, event browsing, matchmaking, chat polling, team management, and the likes system.
- **img/**: Static images including the app logo and downloaded hackathon banner images.

The **templates/** directory holds Jinja2 HTML templates:
- **base.html**: Shared layout with navbar, footer, and block slots for consistent page structure.
- **landing.html**: Public landing page with hero section and GitHub login button.
- **onboarding.html**: First-time user setup with bio, skill picker, and availability matrix.
- **dashboard.html**: User home page showing interested events, pending invites, and unread message count.
- **profile.html** and **profile_edit.html**: User profile display and editing interfaces.
- **events.html** and **event_detail.html**: Hackathon browsing and detailed event pages with interest toggles.
- **find_teammates.html**: Teammate search interface with skill filters and match result cards.
- **inbox.html**: Direct messaging hub with conversation sidebar and chat thread.
- **team.html**: Team detail page with member list and Discord workspace generation.
- **404.html**: Custom error page for a professional appearance.

## Key Features and Implementation Details

### Authentication System
Grid supports dual OAuth authentication through both GitHub and Google, allowing users to sign in with either provider. The system maintains user identity across providers, enabling seamless account linking. Session management uses Flask's built-in server-side cookies for security and simplicity.

### Mutual Matching System
A core feature of Grid is its Tinder-like matching system where users can "like" each other on profiles or within event contexts. When two users mutually like each other, both receive instant notifications via the messaging system, and a conversation can begin immediately. The system includes:
- Like/unlike functionality with visual feedback
- Mutual match detection and notifications
- Like status indicators in messaging conversations (★ for mutual matches, ♥ for sent likes, ♡ for received likes)
- Dashboard integration showing match statistics and notifications

### Matchmaking Algorithm
The intelligent matchmaking engine combines two key metrics:
- **Availability Overlap**: Uses Jaccard similarity to measure overlapping availability in the 7×24 weekly schedule, penalizing users who mark excessive availability
- **Skill Complementarity**: Rewards users who possess skills that complement rather than duplicate the seeker's skills, with shared skills given lower weight

Users can find teammates through two modes:
- **Event-first**: See all users interested in a specific hackathon, ranked by match score
- **Teammate-first**: Search by desired skills and get ranked results

### Real-time Messaging
The messaging system uses short-polling (2-second intervals) for real-time communication without WebSocket complexity. Features include:
- Conversation threading with unread count badges
- Optimistic message sending with retry on failure
- Smart scrolling that preserves user position
- System notifications for matches and Discord invites
- Like status integration in conversation lists

### Team Formation and Discord Integration
Teams can be formed with invite-based membership management. Successful teams can generate private Discord channels within a hub server, with automated invite link delivery through the messaging system. The Discord integration is idempotent, preventing duplicate channel creation.

### Event Management
Hackathon events are automatically scraped from platforms like Unstop using Apify's webhook system. The scraper handles data normalization, image downloading, and deduplication while maintaining data integrity through soft-deletion of past events.

## Design Choices and Rationale

Several key design decisions shaped the development of Grid:

**Flask Framework**: Chosen over more complex frameworks like FastAPI due to its simplicity and alignment with educational goals. Flask's lightweight nature and extensive documentation made it ideal for a project of this scope, allowing focus on application logic rather than framework intricacies.

**Vanilla Frontend**: The decision to use vanilla HTML/CSS/JS without build tools was made to keep the project accessible and reduce complexity. ES modules provide clean code organization, and the dark theme creates a professional, developer-friendly interface that matches the target audience's preferences.

**SQLite Database**: Selected for its zero-configuration deployment and WAL mode support for concurrent access. The sparse availability storage (one row per available slot) enables efficient SQL JOINs for overlap calculations, while foreign key constraints ensure data consistency.

**Dual OAuth Authentication**: Both GitHub and Google OAuth are supported to maximize user accessibility. The system allows users to authenticate with either provider while maintaining a unified account system. Session-based management with server-side cookies provides security without JWT complexity.

**Mutual Matching System**: Implemented as a core feature to encourage engagement, the likes system creates a gamified experience similar to dating apps. Mutual matches trigger instant notifications and conversation prompts, increasing user interaction and platform stickiness.

**Short-Polling Messaging**: Chosen over WebSockets for simplicity and reduced server complexity. The 2-second polling interval provides acceptable latency for chat functionality while being easy to implement and maintain. The polling is optimized with timestamp-based pagination to minimize data transfer.

**Apify Scraping**: External scraping service allows reliable data collection from hackathon platforms without managing complex scraping infrastructure. Webhook-based ingestion ensures real-time updates while maintaining separation of concerns.

**Discord Integration**: Hub server approach simplifies team workspace creation compared to generating entire servers. The idempotent channel creation prevents duplicates and integrates smoothly with the messaging system for invite delivery.

These choices collectively create a robust, user-friendly platform that successfully addresses the challenge of teammate matching in the hackathon community, providing both technical functionality and an intuitive user experience.
