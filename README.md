<br/>
<p align="center">
  <h3 align="center">Filen Desktop</h3>

  <p align="center">
    Desktop client including Syncing, Virtual Drive mounting, S3, WebDAV, File Browsing, Chats, Notes, Contacts and more.
    <br/>
    <br/>
  </p>
</p>

![Contributors](https://img.shields.io/github/contributors/FilenCloudDienste/filen-desktop?color=dark-green) ![Forks](https://img.shields.io/github/forks/FilenCloudDienste/filen-desktop?style=social) ![Stargazers](https://img.shields.io/github/stars/FilenCloudDienste/filen-desktop?style=social) ![Issues](https://img.shields.io/github/issues/FilenCloudDienste/filen-desktop) ![License](https://img.shields.io/github/license/FilenCloudDienste/filen-desktop)

### Installation and building

1. Clone repository

```sh
git clone https://github.com/FilenCloudDienste/filen-desktop filen-desktop
```

2. Update dependencies

```sh
cd filen-desktop && npm install
```

3. Running a development build

To run a development build you need to have "@filen/web" (`npm run dev`) running locally.

```sh
npm run dev
```

4. Build

```sh
npm run build:<os>

Where <os> is either "win", "mac" or "linux"

Building the client requires setting up signing and notarization. See "build/" directory and package.json key.
```

## License

Distributed under the AGPL-3.0 License. See [LICENSE](https://github.com/FilenCloudDienste/filen-desktop/blob/main/LICENSE.md) for more information.
