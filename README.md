# Azure PIM Activator

**Activate your Azure Privileged Identity Management (PIM) roles in one click, without leaving VS Code.**

Stop opening the Azure portal, searching for **My roles**, and filling in the same activation form every morning. Save each eligible role as a profile once, then activate it from the sidebar whenever you need it.

## Features

- **Saved profiles.** A short wizard signs you in, lists your tenants, and shows every role you're eligible for. Pick one and save it as a profile.
- **One-click activation.** Click ▶ on a profile, or run **PIM: Activate profile** from the Command Palette. Progress shows in a notification.
- **Choose how long.** Activations last 8 hours by default. Change the default in settings, or right-click a profile and pick **Set activation length** to give it its own length, from 30 minutes to 24 hours.
- **Live countdown in the status bar.** See which role is active and how much time is left. Click it to activate another profile.
- **Expiry reminders.** You get a warning before a role expires, with a **Re-activate** button to extend it on the spot.
- **Detects active roles.** If the role is already active, the extension tells you when it expires instead of sending a duplicate request.
- **Works across scopes.** Supports eligible roles on subscriptions, resource groups, resources and management groups. You don't need existing access to the subscription to see your eligibilities.
- **No stored secrets.** Sign-in uses VS Code's built-in Microsoft account provider. The extension never sees or saves your password.

## Getting started

1. Install **Azure PIM Activator** from the Marketplace.
2. Click the **Azure PIM** shield icon in the activity bar.
3. Click **New profile** (`+`) and follow the wizard:
   1. Sign in with your Microsoft work or school account.
   2. Pick a tenant.
   3. Pick one of your eligible roles and give the profile a name.
4. Click ▶ next to the profile to activate the role.

That's it. The status bar shows the remaining time while the role is active.

## Commands

| Command | Description |
| --- | --- |
| `PIM: Activate profile` | Activate the role saved in a profile |
| `PIM: New profile` | Create a profile from one of your eligible roles |
| `PIM: Set activation length` | Change how long a profile's role stays active |
| `PIM: Delete profile` | Remove a saved profile |
| `PIM: Refresh` | Refresh the profile list and activation status |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `pim.activationHours` | `8` | Default activation length in hours (0.5–24) for profiles that don't set their own. |
| `pim.reminderMinutes` | `15` | How many minutes before expiry to show a reminder. Set to `0` to turn reminders off. |

## Requirements

- VS Code 1.90 or later.
- A Microsoft Entra ID (Azure AD) account with at least one **eligible** PIM role assignment on an Azure resource.
- The role's PIM settings must allow self-activation (no approval or ticket number required).

## Privacy

The extension talks only to Microsoft's Azure Resource Manager API (`management.azure.com`) using the token VS Code gives it. Profiles store only role, tenant and scope identifiers, in VS Code's local extension storage. No data is sent anywhere else.

## Known limitations

- The activation length can't be longer than the role's PIM policy allows (often 8 hours). If you pick a longer one, the extension tells you and lets you choose again.
- Microsoft Entra ID directory roles (for example Global Administrator) and PIM for Groups aren't supported yet. Only Azure resource roles are.
- Roles that need approval or a ticket number can't be activated from the extension.

## Feedback

Found a bug or have an idea? [Open an issue on GitHub](https://github.com/charith0901/azure-pim-activator/issues), or leave a review on the Marketplace page.

## License

[MIT](LICENSE)
