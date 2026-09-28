# QuizMaster Pro - Setup

This version contains:

- 150 quiz questions (30 each for Java, C, Python, Aptitude and GK)
- GATE-style question palette
- Skip button
- Green/red circular timer
- Detailed answer explanations
- Unique Registration IDs
- Shared registered-user count through Firebase Firestore
- Secure email OTP signup/login through Supabase Auth
- Registration-ID login as an additional requested option

## 1. Supabase email OTP setup (required for real OTP)

The browser cannot securely send email OTPs by itself. This project uses Supabase Auth for the OTP service.

1. Create a project at https://supabase.com/
2. Open **Project Settings -> API**.
3. Copy the **Project URL** and the **anon public key**.
4. Open `script.js`.
5. Open `supabase-config.js` and replace:

```js
window.QMP_SUPABASE_CONFIG = {
    url: "YOUR_SUPABASE_URL",
    anonKey: "YOUR_SUPABASE_ANON_KEY"
};
```

with your real Project URL and anon public key. You do not need to edit `script.js`.

### Create the profile table

Open **SQL Editor** in Supabase and run the complete `supabase.sql` file included with this project.

### Enable email OTP

In Supabase:

**Authentication -> Providers -> Email**

Enable the Email provider.

For a 6-digit OTP experience, configure the email template to include:

```text
{{ .Token }}
```

instead of relying only on the magic-link URL.

For production, configure a proper SMTP/email provider in Supabase.

## 2. Firebase shared registered-user count

The Firebase section is only used for the shared registered-user count across laptops.

1. Create a Firebase project.
2. Enable Firestore Database.
3. Add a Web App.
4. Copy its Firebase configuration.
5. Replace the placeholder `firebaseConfig` values in `script.js`.
6. Apply the rules in `firestore.rules`.

If Firebase is not configured, the count falls back to local browser storage and will not be shared between laptops.

## 3. Run the project

For the best experience, use a local web server because `questions.txt` is fetched by the browser.

Example with VS Code:

- Install the Live Server extension.
- Right-click `index.html`.
- Choose **Open with Live Server**.

The built-in question bank also allows the quiz questions to work when `index.html` is opened directly.

## 4. Signup flow

1. Open the first page.
2. Choose **Sign Up**.
3. Enter Name.
4. Enter Mail ID.
5. Click **Send OTP**.
6. Enter the OTP received by email.
7. Click **Sign Up**.
8. A unique Registration ID such as `QMP-7A3F91C2` is created.

## 5. Login flow

### Email OTP

1. Choose **Login**.
2. Enter Mail ID.
3. Click **Send OTP**.
4. Enter the OTP.
5. Click **Login**.

### Registration ID

Enter the Registration ID shown in the user's profile and click **Login**.

Because the requested Registration-ID login does not require an OTP, treat the Registration ID as a credential and do not share it publicly. Email OTP login is the stronger authentication method.
