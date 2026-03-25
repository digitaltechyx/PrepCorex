# **App Name**: PrepCorex

## Core Features:

- User Authentication: Secure user authentication system with role-based access control (admin/user) using Firebase Authentication. Supports registration and login with email and password.
- User Dashboard: View-only dashboard for regular users to see their assigned inventory and shipped orders. Includes real-time updates.
- Admin Dashboard: Admin dashboard with user management and inventory control features.
- User Management: Admin can list, search, and filter registered users to manage their individual inventory.
- Inventory Management: Admin can add inventory and track shipped items for each user with real-time updates using Firestore listeners.
- Data Storage: Data stored securely in Firestore with defined schema for users, inventory, and shipped items.
- Route Management: Implement proper routing for different roles and dashboards (/login, /register, /dashboard, /admin/login, /admin/dashboard).

## Style Guidelines:

- Primary color: Deep Blue (#1A237E) to convey trust and stability, important for inventory management.
- Background color: Light gray (#F5F5F5), creating a clean and professional backdrop for the interface.
- Accent color: Teal (#008080) used for interactive elements and highlights, providing a visual cue for important actions.
- Headline font: 'Space Grotesk', a modern sans-serif font with a tech-forward feel.
- Body font: 'Inter', a grotesque-style sans-serif offering great legibility.
- Use simple, line-based icons to represent inventory items and actions. Icons should be consistent and intuitive.
- Design a clear and organized layout with separate sections for user management, inventory, and shipped orders. Use card-based design for information display.
- Implement subtle animations for data updates and transitions. Focus on smooth and responsive interactions to improve usability.