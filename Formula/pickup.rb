class Pickup < Formula
  desc "Fast, clean session resume picker for Claude Code, GitHub Copilot CLI, and OpenAI Codex"
  homepage "https://github.com/AKalymon/pickup"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/AKalymon/pickup/releases/download/v#{version}/pickup-darwin-arm64"
      sha256 :no_check
    end
    on_intel do
      url "https://github.com/AKalymon/pickup/releases/download/v#{version}/pickup-darwin-x64"
      sha256 :no_check
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/AKalymon/pickup/releases/download/v#{version}/pickup-linux-arm64"
      sha256 :no_check
    end
    on_intel do
      url "https://github.com/AKalymon/pickup/releases/download/v#{version}/pickup-linux-x64"
      sha256 :no_check
    end
  end

  def install
    bin.install Dir["pickup*"].first => "pickup"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/pickup --version")
  end
end
