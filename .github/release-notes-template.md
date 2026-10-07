## raw-images-studio <version>（Windows x64）

### 下载哪个

| 文件 | 说明 |
| --- | --- |
| `raw-images-studio-<version>-win-x64-setup.exe` | 安装版（装到当前用户，不需要管理员权限） |
| `raw-images-studio-<version>-win-x64-portable.zip` | 便携版（解压即用） |

SHA256 见 `SHA256SUMS.txt`。自证完整性的方法（PowerShell）：

    Get-FileHash .\raw-images-studio-<version>-win-x64-setup.exe -Algorithm SHA256

### 这个包没有代码签名

你会看到蓝色的 **「Windows protected your PC」**。点 **「更多信息」→「仍要运行」** 即可安装。
这不是文件损坏，是本项目没有购买代码签名证书；为什么不做、代价是什么，见 README 的「Windows 桌面版」一节。

### 其他

- 只支持 64 位 Windows（Win10 1809+ / Win11）。
- 完全离线可用：34 个官方 LUT 全部随包。
- 用户数据在 `%APPDATA%\raw-images-studio`；卸载不会删它。
