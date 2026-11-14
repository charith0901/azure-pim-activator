# Changelog

## 0.4.0

### Added
- **Desktop notifications.** Expiry reminders, expirations and activation results now also appear as native OS notifications when VS Code isn't focused. Turn them off with the new `pim.desktopNotifications` setting.
- A notice, with a **Re-activate** button, when an activation has expired.

## 0.3.1

### Changed
- **Faster activation.** Activation now finishes as soon as Azure accepts the request. It no longer waits, sometimes for minutes, for Azure to report the role as provisioned, because the role can already be used at that point.

## 0.3.0

### Added
- **Configurable activation length.** Set a default with the new `pim.activationHours` setting (8 hours unless changed), or right-click a profile and choose **Set activation length** to give it its own length, from 30 minutes to 24 hours.
- A clear error with a **Set activation length** button when the chosen length is longer than the role's PIM policy allows.
- The profile tooltip shows the activation length.
- New Marketplace icon and a redesigned activity bar icon.

### Changed
- Licensed under MIT.
- Added repository, issues and homepage links.

## 0.2.1 and earlier

- Initial releases: saved profiles, one-click activation, status bar countdown, expiry reminders and detection of roles that are already active.
