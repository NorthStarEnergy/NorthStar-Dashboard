# Microsoft Graph personal account setup

This connector uses delegated sign-in for a personal Microsoft account. It reads the signed-in profile and basic Outlook message headers. It does not send email, copy messages into NorthStar Events, or access personal Teams chats.

## Create the Microsoft app registration

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) and go to **Identity → Applications → App registrations → New registration**. Microsoft's guide to [registering an app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) has the same steps.
2. Name it `NorthStar Local Graph`.
3. Choose **Personal Microsoft accounts only** under supported account types, then select **Register**.
4. Copy the **Application (client) ID**.
5. Open **Authentication → Advanced settings** and set **Allow public client flows** to **Yes**. Save.
6. Open **API permissions → Add a permission → Microsoft Graph → Delegated permissions**. Add `User.Read` and `Mail.ReadBasic`. Do not add application permissions or a client secret.
7. Install the updated Python requirements with `python -m pip install -r requirements.txt`. In the local NorthStar `.env.local` file, add `NORTHSTAR_GRAPH_CLIENT_ID=<client-id>` and restart the local backend.
8. Sign in to the local NorthStar dashboard as an operator. `GET /api/microsoft/graph/status` reports setup state; `POST /api/microsoft/graph/connect` starts sign-in. Enter the returned code at the Microsoft verification URL, sign in to the personal account, and approve the requested read permissions.
9. Use `GET /api/microsoft/graph/profile` and `GET /api/microsoft/graph/messages?limit=25` to read the profile and recent message headers.

Tokens are held in Windows DPAPI-encrypted local storage beside the NorthStar database. The client ID is not a secret. `Mail.ReadBasic` reads message headers and does not expose message bodies or previews. Microsoft documents the [Graph message-list API](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0). If the account connection is no longer needed, remove the app's consent under the Microsoft account's **Privacy → Apps and services** page and remove the local encrypted cache file.

## Personal Teams limitation

Signing in with a personal Microsoft account does not enable Teams chat through Graph. Microsoft lists delegated personal-account access to Teams chat messages and message notifications as unsupported ([chat messages](https://learn.microsoft.com/en-us/graph/api/chat-list-messages?view=graph-rest-1.0), [change notifications](https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage)). The dashboard's Teams pane remains the supported way to use Teams itself. Graph chat collection requires a work or school account and a separately approved tenant integration.
