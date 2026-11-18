# Outage navigation and UWPC library

The sidebar displays the last outage folder in the Outages register and the selected folder on package pages. Home, New, UWPC, Reports and Inbox show the top-level menu. The register and report selector still remember the current outage.

The visitor UWPC library opens in the compact reader, with searchable contents, PDF and text views, a page selector, a collapsible index and fullscreen. The visitor guide contains NorthStar worksheets and practice questions. Each form links to its guide page and downloads as a PDF or editable Excel worksheet. The Licensed manual link opens the operator reader for the original Code and illustrated form pages. The form controls on outage packages continue to export the selected document.

Build the visitor guide with `public-outage/build-uwpc-reference.py <output.json>`. Supply the resulting bundle as the fourth argument to the public Site Worker. The authenticated visitor station check runs before the library routes. No operational records or controlled source files are included in the bundle.
