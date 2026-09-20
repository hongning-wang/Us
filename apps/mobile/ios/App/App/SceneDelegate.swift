import UIKit
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: scene)
        window?.rootViewController = InstagramViewController()
        window?.makeKeyAndVisible()
    }
}

// Instagram supplies the entire interface. Our isolated script is the existing extension.
final class InstagramViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private var webView: WKWebView!
    private var backend: URL!
    private let inbox = URL(string: "https://www.instagram.com/direct/inbox/")!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        do {
            let configURL = Bundle.main.url(forResource: "us-config", withExtension: "json", subdirectory: "public")!
            let config = try JSONSerialization.jsonObject(with: Data(contentsOf: configURL)) as! [String: String]
            backend = URL(string: config["backend"]!)!
            let sourceURL = Bundle.main.url(forResource: "us-instagram", withExtension: "js", subdirectory: "public")!
            let source = try String(contentsOf: sourceURL, encoding: .utf8)
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .default()
            configuration.allowsInlineMediaPlayback = true
            configuration.defaultWebpagePreferences.preferredContentMode = .desktop
            // The Instagram page cannot call our native API or read extension storage.
            configuration.userContentController.addScriptMessageHandler(self, contentWorld: .defaultClient, name: "us")
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
            webView = WKWebView(frame: .zero, configuration: configuration)
            webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
            webView.navigationDelegate = self
            webView.uiDelegate = self
            webView.allowsBackForwardNavigationGestures = true
            webView.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(webView)
            NSLayoutConstraint.activate([
                webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
                webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
            ])
            webView.load(URLRequest(url: inbox))
        } catch { showError(error.localizedDescription) }
    }

    private func instagram(_ url: URL?) -> Bool {
        url?.scheme == "https" && ["www.instagram.com", "instagram.com"].contains(url?.host ?? "")
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if instagram(url) || url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        // Keep Instagram web links inside this app instead of opening Meta's app.
        if url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if instagram(action.request.url) { webView.load(action.request) }
        else if let url = action.request.url, ["http", "https"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError(error.localizedDescription) }
    }
    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Could not load Instagram", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Retry", style: .default) { [weak self] _ in
            guard let self = self else { return }; self.webView?.load(URLRequest(url: self.inbox))
        })
        present(alert, animated: true)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler reply: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, instagram(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let type = body["type"] as? String else {
            reply(nil, "Untrusted message."); return
        }
        if type == "storage" {
            let defaults = UserDefaults.standard
            var values = (defaults.data(forKey: "us.extension").flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            let key = body["key"] as? String ?? ""
            switch body["action"] as? String {
            case "get": reply(values[key].map { [key: $0] } ?? [:], nil)
            case "set":
                guard let updates = body["values"] as? [String: Any], updates.keys.allSatisfy({ $0.hasPrefix("us:") }) else { reply(nil, "Invalid storage key."); return }
                for (key, value) in updates { values[key] = value }
                defaults.set(try? JSONSerialization.data(withJSONObject: values), forKey: "us.extension"); reply([:], nil)
            case "remove": values.removeValue(forKey: key); defaults.set(try? JSONSerialization.data(withJSONObject: values), forKey: "us.extension"); reply([:], nil)
            default: reply(nil, "Unsupported storage action.")
            }
            return
        }
        var request: URLRequest
        if type == "us-api" {
            guard let path = body["path"] as? String,
                  path.range(of: "^/api/(setup|photo|history|jobs|media|references)([/?.]|$)", options: .regularExpression) != nil,
                  !(path.removingPercentEncoding ?? path).contains(".."),
                  let url = URL(string: path, relativeTo: backend)?.absoluteURL, url.host == backend.host else {
                reply(nil, "Unsupported request."); return
            }
            request = URLRequest(url: url)
            let method = body["method"] as? String ?? "GET"
            guard ["GET", "POST", "DELETE"].contains(method) else { reply(nil, "Unsupported method."); return }
            request.httpMethod = method
            if let payload = body["body"] as? [String: Any] {
                if let upload = payload["upload"] as? [String: String], let encoded = upload["data"], let bytes = Data(base64Encoded: encoded) {
                    let boundary = UUID().uuidString
                    var data = Data()
                    func append(_ text: String) { data.append(Data(text.utf8)) }
                    for (key, value) in payload["fields"] as? [String: String] ?? [:] {
                        guard key.range(of: "^[a-zA-Z]+$", options: .regularExpression) != nil else { continue }
                        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n")
                    }
                    let mime = upload["type"] ?? "application/octet-stream"
                    guard !mime.contains("\r"), !mime.contains("\n"), bytes.count <= 30 * 1024 * 1024 else { reply(nil, "Invalid upload."); return }
                    append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\nContent-Type: \(mime)\r\n\r\n")
                    data.append(bytes); append("\r\n--\(boundary)--\r\n")
                    request.httpBody = data
                    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
                } else {
                    request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                }
            }
        } else if type == "us-photo-file", let raw = body["url"] as? String, let url = URL(string: raw), url.scheme == "https",
                  let host = url.host, ["cdninstagram.com", "fbcdn.net"].contains(where: { host == $0 || host.hasSuffix("." + $0) }) {
            request = URLRequest(url: url)
        } else { reply(nil, "Unsupported request."); return }
        request.timeoutInterval = 30
        URLSession.shared.dataTask(with: request) { data, response, error in
            var result: [String: Any]
            if let error = error { result = ["error": error.localizedDescription] }
            else if let data = data, let response = response as? HTTPURLResponse {
                if !(200...299).contains(response.statusCode) {
                    let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                    result = ["error": json?["error"] as? String ?? "Backend returned HTTP \(response.statusCode)."]
                } else if data.count > 30 * 1024 * 1024 { result = ["error": "File is too large."] }
                else if type == "us-photo-file" { result = ["data": ["data": data.base64EncodedString(), "mime": response.mimeType ?? "image/jpeg"]] }
                else if body["binary"] as? Bool == true { result = ["data": data.base64EncodedString(), "mime": response.mimeType ?? "application/octet-stream"] }
                else if let json = try? JSONSerialization.jsonObject(with: data) { result = ["data": json] }
                else { result = ["error": "Invalid response from the Mac backend."] }
            } else { result = ["error": "No response from the Mac backend."] }
            DispatchQueue.main.async { reply(result, nil) }
        }.resume()
    }
}
