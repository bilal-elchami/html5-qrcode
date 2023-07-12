import { Html5QrcodeConstants, Html5QrcodeScanType, Html5QrcodeErrorFactory, BaseLoggger, isNullOrUndefined, clip, } from "./core";
import { Html5Qrcode, } from "./html5-qrcode";
import { Html5QrcodeScannerStrings, } from "./strings";
import { ASSET_FILE_SCAN, ASSET_CAMERA_SCAN, } from "./image-assets";
import { PersistedDataManager } from "./storage";
import { LibraryInfoContainer } from "./ui";
import { CameraPermissions } from "./camera/permissions";
import { ScanTypeSelector } from "./ui/scanner/scan-type-selector";
import { TorchButton } from "./ui/scanner/torch-button";
import { FileSelectionUi } from "./ui/scanner/file-selection-ui";
import { BaseUiElementFactory, PublicUiElementIdAndClasses } from "./ui/scanner/base";
import { CameraSelectionUi } from "./ui/scanner/camera-selection-ui";
import { CameraZoomUi } from "./ui/scanner/camera-zoom-ui";
var Html5QrcodeScannerStatus;
(function (Html5QrcodeScannerStatus) {
    Html5QrcodeScannerStatus[Html5QrcodeScannerStatus["STATUS_DEFAULT"] = 0] = "STATUS_DEFAULT";
    Html5QrcodeScannerStatus[Html5QrcodeScannerStatus["STATUS_SUCCESS"] = 1] = "STATUS_SUCCESS";
    Html5QrcodeScannerStatus[Html5QrcodeScannerStatus["STATUS_WARNING"] = 2] = "STATUS_WARNING";
    Html5QrcodeScannerStatus[Html5QrcodeScannerStatus["STATUS_REQUESTING_PERMISSION"] = 3] = "STATUS_REQUESTING_PERMISSION";
})(Html5QrcodeScannerStatus || (Html5QrcodeScannerStatus = {}));
function toHtml5QrcodeCameraScanConfig(config) {
    return {
        fps: config.fps,
        qrbox: config.qrbox,
        aspectRatio: config.aspectRatio,
        disableFlip: config.disableFlip,
        videoConstraints: config.videoConstraints
    };
}
function toHtml5QrcodeFullConfig(config, verbose) {
    return {
        formatsToSupport: config.formatsToSupport,
        useBarCodeDetectorIfSupported: config.useBarCodeDetectorIfSupported,
        experimentalFeatures: config.experimentalFeatures,
        verbose: verbose
    };
}
export class Html5QrcodeScanner {
    constructor(elementOrId, config, verbose) {
        this.lastMatchFound = null;
        this.cameraScanImage = null;
        this.fileScanImage = null;
        this.fileSelectionUi = null;
        this.scpCameraScanRegion = null;
        this.dashboardSection = null;
        this.permissionButton = null;
        this.headerMessageContainer = null;
        this.qrCodeScanRegion = null;
        this.switchScanTypeLink = null;
        if (typeof elementOrId === "string") {
            this.container = this.validateInputAsStringId(elementOrId);
        }
        else {
            this.container = this.validateInputAsHTMLElement(elementOrId);
        }
        this.config = this.createConfig(config);
        this.verbose = verbose === true;
        this.scanTypeSelector = new ScanTypeSelector(this.config.supportedScanTypes);
        this.currentScanType = this.scanTypeSelector.getDefaultScanType();
        this.sectionSwapAllowed = true;
        this.logger = new BaseLoggger(this.verbose);
        this.persistedDataManager = new PersistedDataManager();
        if (config.rememberLastUsedCamera !== true) {
            this.persistedDataManager.reset();
        }
    }
    render(qrCodeSuccessCallback, qrCodeErrorCallback) {
        this.lastMatchFound = null;
        this.qrCodeSuccessCallback
            = (decodedText, result) => {
                if (qrCodeSuccessCallback) {
                    qrCodeSuccessCallback(decodedText, result);
                }
                else {
                    if (this.lastMatchFound === decodedText) {
                        return;
                    }
                    this.lastMatchFound = decodedText;
                    this.setHeaderMessage(Html5QrcodeScannerStrings.lastMatch(decodedText), Html5QrcodeScannerStatus.STATUS_SUCCESS);
                }
            };
        this.qrCodeErrorCallback =
            (errorMessage, error) => {
                if (qrCodeErrorCallback) {
                    qrCodeErrorCallback(errorMessage, error);
                }
            };
        if (!this.container) {
            throw "HTML Element not found";
        }
        this.container.innerHTML = "";
        this.createBasicLayout(this.container);
        this.html5Qrcode = new Html5Qrcode(this.qrCodeScanRegion, toHtml5QrcodeFullConfig(this.config, this.verbose));
    }
    pause(shouldPauseVideo) {
        if (isNullOrUndefined(shouldPauseVideo) || shouldPauseVideo !== true) {
            shouldPauseVideo = false;
        }
        this.getHtml5QrcodeOrFail().pause(shouldPauseVideo);
    }
    resume() {
        this.getHtml5QrcodeOrFail().resume();
    }
    getState() {
        return this.getHtml5QrcodeOrFail().getState();
    }
    clear() {
        const emptyHtmlContainer = () => {
            if (this.container) {
                this.container.innerHTML = "";
                this.resetBasicLayout(this.container);
            }
        };
        if (this.html5Qrcode) {
            return new Promise((resolve, reject) => {
                if (!this.html5Qrcode) {
                    resolve();
                    return;
                }
                if (this.html5Qrcode.isScanning) {
                    this.html5Qrcode.stop().then((_) => {
                        if (!this.html5Qrcode) {
                            resolve();
                            return;
                        }
                        this.html5Qrcode.clear();
                        emptyHtmlContainer();
                        resolve();
                    }).catch((error) => {
                        if (this.verbose) {
                            this.logger.logError("Unable to stop qrcode scanner", error);
                        }
                        reject(error);
                    });
                }
                else {
                    this.html5Qrcode.clear();
                    emptyHtmlContainer();
                    resolve();
                }
            });
        }
        return Promise.resolve();
    }
    getRunningTrackCapabilities() {
        return this.getHtml5QrcodeOrFail().getRunningTrackCapabilities();
    }
    getRunningTrackSettings() {
        return this.getHtml5QrcodeOrFail().getRunningTrackSettings();
    }
    applyVideoConstraints(videoConstraints) {
        return this.getHtml5QrcodeOrFail().applyVideoConstraints(videoConstraints);
    }
    validateInputAsStringId(elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            throw `HTML Element with id=${elementId} not found`;
        }
        return element;
    }
    validateInputAsHTMLElement(element) {
        if (!element || !(element instanceof HTMLElement)) {
            throw "HTML Element is not valid";
        }
        return element;
    }
    getHtml5QrcodeOrFail() {
        if (!this.html5Qrcode) {
            throw "Code scanner not initialized.";
        }
        return this.html5Qrcode;
    }
    createConfig(config) {
        if (config) {
            if (!config.fps) {
                config.fps = Html5QrcodeConstants.SCAN_DEFAULT_FPS;
            }
            if (config.rememberLastUsedCamera !== (!Html5QrcodeConstants.DEFAULT_REMEMBER_LAST_CAMERA_USED)) {
                config.rememberLastUsedCamera
                    = Html5QrcodeConstants.DEFAULT_REMEMBER_LAST_CAMERA_USED;
            }
            if (!config.supportedScanTypes) {
                config.supportedScanTypes
                    = Html5QrcodeConstants.DEFAULT_SUPPORTED_SCAN_TYPE;
            }
            return config;
        }
        return {
            fps: Html5QrcodeConstants.SCAN_DEFAULT_FPS,
            rememberLastUsedCamera: Html5QrcodeConstants.DEFAULT_REMEMBER_LAST_CAMERA_USED,
            supportedScanTypes: Html5QrcodeConstants.DEFAULT_SUPPORTED_SCAN_TYPE
        };
    }
    createBasicLayout(parent) {
        parent.style.position = "relative";
        parent.style.padding = "0px";
        parent.style.border = "1px solid silver";
        this.createHeader(parent);
        this.qrCodeScanRegion = document.createElement("div");
        const scanRegionId = this.getScanRegionId();
        this.qrCodeScanRegion.id = scanRegionId;
        this.qrCodeScanRegion.style.width = "100%";
        this.qrCodeScanRegion.style.minHeight = "100px";
        this.qrCodeScanRegion.style.textAlign = "center";
        parent.appendChild(this.qrCodeScanRegion);
        if (ScanTypeSelector.isCameraScanType(this.currentScanType)) {
            this.insertCameraScanImageToScanRegion();
        }
        else {
            this.insertFileScanImageToScanRegion();
        }
        const qrCodeDashboard = document.createElement("div");
        const dashboardId = this.getDashboardId();
        qrCodeDashboard.id = dashboardId;
        qrCodeDashboard.style.width = "100%";
        parent.appendChild(qrCodeDashboard);
        this.setupInitialDashboard(qrCodeDashboard);
    }
    resetBasicLayout(mainContainer) {
        mainContainer.style.border = "none";
    }
    setupInitialDashboard(dashboard) {
        this.createSection(dashboard);
        this.createSectionControlPanel();
        if (this.scanTypeSelector.hasMoreThanOneScanType()) {
            this.createSectionSwap();
        }
    }
    createHeader(dashboard) {
        const header = document.createElement("div");
        header.style.textAlign = "left";
        header.style.margin = "0px";
        dashboard.appendChild(header);
        let libraryInfo = new LibraryInfoContainer();
        libraryInfo.renderInto(header);
        this.headerMessageContainer = document.createElement("div");
        this.headerMessageContainer.id = this.getHeaderMessageContainerId();
        this.headerMessageContainer.style.display = "none";
        this.headerMessageContainer.style.textAlign = "center";
        this.headerMessageContainer.style.fontSize = "14px";
        this.headerMessageContainer.style.padding = "2px 10px";
        this.headerMessageContainer.style.margin = "4px";
        this.headerMessageContainer.style.borderTop = "1px solid #f6f6f6";
        header.appendChild(this.headerMessageContainer);
    }
    createSection(dashboard) {
        this.dashboardSection = document.createElement("div");
        this.dashboardSection.id = this.getDashboardSectionId();
        this.dashboardSection.style.width = "100%";
        this.dashboardSection.style.padding = "10px 0px 10px 0px";
        this.dashboardSection.style.textAlign = "left";
        dashboard.appendChild(this.dashboardSection);
    }
    createCameraListUi(scpCameraScanRegion, requestPermissionContainer, requestPermissionButton) {
        const $this = this;
        $this.showHideScanTypeSwapLink(false);
        $this.setHeaderMessage(Html5QrcodeScannerStrings.cameraPermissionRequesting());
        const createPermissionButtonIfNotExists = () => {
            if (!requestPermissionButton) {
                $this.createPermissionButton(scpCameraScanRegion, requestPermissionContainer);
            }
        };
        Html5Qrcode.getCameras().then((cameras) => {
            $this.persistedDataManager.setHasPermission(true);
            $this.showHideScanTypeSwapLink(true);
            $this.resetHeaderMessage();
            if (cameras && cameras.length > 0) {
                scpCameraScanRegion.removeChild(requestPermissionContainer);
                $this.renderCameraSelection(cameras);
            }
            else {
                $this.setHeaderMessage(Html5QrcodeScannerStrings.noCameraFound(), Html5QrcodeScannerStatus.STATUS_WARNING);
                createPermissionButtonIfNotExists();
            }
        }).catch((error) => {
            $this.persistedDataManager.setHasPermission(false);
            if (requestPermissionButton) {
                requestPermissionButton.disabled = false;
            }
            else {
                createPermissionButtonIfNotExists();
            }
            $this.setHeaderMessage(error, Html5QrcodeScannerStatus.STATUS_WARNING);
            $this.showHideScanTypeSwapLink(true);
        });
    }
    createPermissionButton(scpCameraScanRegion, requestPermissionContainer) {
        const $this = this;
        const requestPermissionButton = BaseUiElementFactory
            .createElement("button", this.getCameraPermissionButtonId());
        requestPermissionButton.innerText
            = Html5QrcodeScannerStrings.cameraPermissionTitle();
        requestPermissionButton.addEventListener("click", function () {
            requestPermissionButton.disabled = true;
            $this.createCameraListUi(scpCameraScanRegion, requestPermissionContainer, requestPermissionButton);
        });
        requestPermissionContainer.appendChild(requestPermissionButton);
    }
    createPermissionsUi(scpCameraScanRegion, requestPermissionContainer) {
        const $this = this;
        if (ScanTypeSelector.isCameraScanType(this.currentScanType)
            && this.persistedDataManager.hasCameraPermissions()) {
            CameraPermissions.hasPermissions().then((hasPermissions) => {
                if (hasPermissions) {
                    $this.createCameraListUi(scpCameraScanRegion, requestPermissionContainer);
                }
                else {
                    $this.persistedDataManager.setHasPermission(false);
                    $this.createPermissionButton(scpCameraScanRegion, requestPermissionContainer);
                }
            }).catch((_) => {
                $this.persistedDataManager.setHasPermission(false);
                $this.createPermissionButton(scpCameraScanRegion, requestPermissionContainer);
            });
            return;
        }
        this.createPermissionButton(scpCameraScanRegion, requestPermissionContainer);
    }
    createSectionControlPanel() {
        const sectionControlPanel = document.createElement("div");
        this.dashboardSection.appendChild(sectionControlPanel);
        this.scpCameraScanRegion = document.createElement("div");
        this.scpCameraScanRegion.id = this.getDashboardSectionCameraScanRegionId();
        this.scpCameraScanRegion.style.display
            = ScanTypeSelector.isCameraScanType(this.currentScanType)
                ? "block" : "none";
        sectionControlPanel.appendChild(this.scpCameraScanRegion);
        const requestPermissionContainer = document.createElement("div");
        requestPermissionContainer.style.textAlign = "center";
        this.scpCameraScanRegion.appendChild(requestPermissionContainer);
        if (this.scanTypeSelector.isCameraScanRequired()) {
            this.createPermissionsUi(this.scpCameraScanRegion, requestPermissionContainer);
        }
        this.renderFileScanUi(sectionControlPanel);
    }
    renderFileScanUi(parent) {
        let showOnRender = ScanTypeSelector.isFileScanType(this.currentScanType);
        const $this = this;
        let onFileSelected = (file) => {
            if (!$this.html5Qrcode) {
                throw "html5Qrcode not defined";
            }
            if (!ScanTypeSelector.isFileScanType($this.currentScanType)) {
                return;
            }
            $this.setHeaderMessage(Html5QrcodeScannerStrings.loadingImage());
            $this.html5Qrcode.scanFileV2(file, true)
                .then((html5qrcodeResult) => {
                $this.resetHeaderMessage();
                $this.qrCodeSuccessCallback(html5qrcodeResult.decodedText, html5qrcodeResult);
            })
                .catch((error) => {
                $this.setHeaderMessage(error, Html5QrcodeScannerStatus.STATUS_WARNING);
                $this.qrCodeErrorCallback(error, Html5QrcodeErrorFactory.createFrom(error));
            });
        };
        this.fileSelectionUi = FileSelectionUi.create(parent, showOnRender, onFileSelected);
    }
    renderCameraSelection(cameras) {
        const $this = this;
        this.scpCameraScanRegion.style.textAlign = "center";
        let cameraZoomUi = CameraZoomUi.create(this.scpCameraScanRegion, false);
        const renderCameraZoomUiIfSupported = (cameraCapabilities) => {
            let zoomCapability = cameraCapabilities.zoomFeature();
            if (!zoomCapability.isSupported()) {
                return;
            }
            cameraZoomUi.setOnCameraZoomValueChangeCallback((zoomValue) => {
                zoomCapability.apply(zoomValue);
            });
            let defaultZoom = 1;
            if (this.config.defaultZoomValueIfSupported) {
                defaultZoom = this.config.defaultZoomValueIfSupported;
            }
            defaultZoom = clip(defaultZoom, zoomCapability.min(), zoomCapability.max());
            cameraZoomUi.setValues(zoomCapability.min(), zoomCapability.max(), defaultZoom, zoomCapability.step());
            cameraZoomUi.show();
        };
        let cameraSelectUi = CameraSelectionUi.create(this.scpCameraScanRegion, cameras);
        const cameraActionContainer = document.createElement("span");
        const cameraActionStartButton = BaseUiElementFactory.createElement("button", PublicUiElementIdAndClasses.CAMERA_START_BUTTON_ID);
        cameraActionStartButton.innerText
            = Html5QrcodeScannerStrings.scanButtonStartScanningText();
        cameraActionContainer.appendChild(cameraActionStartButton);
        const cameraActionStopButton = BaseUiElementFactory.createElement("button", PublicUiElementIdAndClasses.CAMERA_STOP_BUTTON_ID);
        cameraActionStopButton.innerText
            = Html5QrcodeScannerStrings.scanButtonStopScanningText();
        cameraActionStopButton.style.display = "none";
        cameraActionStopButton.disabled = true;
        cameraActionContainer.appendChild(cameraActionStopButton);
        let torchButton;
        const createAndShowTorchButtonIfSupported = (cameraCapabilities) => {
            if (!cameraCapabilities.torchFeature().isSupported()) {
                if (torchButton) {
                    torchButton.hide();
                }
                return;
            }
            if (!torchButton) {
                torchButton = TorchButton.create(cameraActionContainer, cameraCapabilities.torchFeature(), { display: "none", marginLeft: "5px" }, (errorMessage) => {
                    $this.setHeaderMessage(errorMessage, Html5QrcodeScannerStatus.STATUS_WARNING);
                });
            }
            else {
                torchButton.updateTorchCapability(cameraCapabilities.torchFeature());
            }
            torchButton.show();
        };
        this.scpCameraScanRegion.appendChild(cameraActionContainer);
        const resetCameraActionStartButton = (shouldShow) => {
            if (!shouldShow) {
                cameraActionStartButton.style.display = "none";
            }
            cameraActionStartButton.innerText
                = Html5QrcodeScannerStrings
                    .scanButtonStartScanningText();
            cameraActionStartButton.style.opacity = "1";
            cameraActionStartButton.disabled = false;
            if (shouldShow) {
                cameraActionStartButton.style.display = "inline-block";
            }
        };
        cameraActionStartButton.addEventListener("click", (_) => {
            cameraActionStartButton.innerText
                = Html5QrcodeScannerStrings.scanButtonScanningStarting();
            cameraSelectUi.disable();
            cameraActionStartButton.disabled = true;
            cameraActionStartButton.style.opacity = "0.5";
            if (this.scanTypeSelector.hasMoreThanOneScanType()) {
                $this.showHideScanTypeSwapLink(false);
            }
            $this.resetHeaderMessage();
            const cameraId = cameraSelectUi.getValue();
            $this.persistedDataManager.setLastUsedCameraId(cameraId);
            $this.html5Qrcode.start(cameraId, toHtml5QrcodeCameraScanConfig($this.config), $this.qrCodeSuccessCallback, $this.qrCodeErrorCallback)
                .then((_) => {
                cameraActionStopButton.disabled = false;
                cameraActionStopButton.style.display = "inline-block";
                resetCameraActionStartButton(false);
                const cameraCapabilities = $this.html5Qrcode.getRunningTrackCameraCapabilities();
                if (this.config.showTorchButtonIfSupported === true) {
                    createAndShowTorchButtonIfSupported(cameraCapabilities);
                }
                if (this.config.showZoomSliderIfSupported === true) {
                    renderCameraZoomUiIfSupported(cameraCapabilities);
                }
            })
                .catch((error) => {
                $this.showHideScanTypeSwapLink(true);
                cameraSelectUi.enable();
                resetCameraActionStartButton(true);
                $this.setHeaderMessage(error, Html5QrcodeScannerStatus.STATUS_WARNING);
            });
        });
        if (cameraSelectUi.hasSingleItem()) {
            cameraActionStartButton.click();
        }
        cameraActionStopButton.addEventListener("click", (_) => {
            if (!$this.html5Qrcode) {
                throw "html5Qrcode not defined";
            }
            cameraActionStopButton.disabled = true;
            $this.html5Qrcode.stop()
                .then((_) => {
                if (this.scanTypeSelector.hasMoreThanOneScanType()) {
                    $this.showHideScanTypeSwapLink(true);
                }
                cameraSelectUi.enable();
                cameraActionStartButton.disabled = false;
                cameraActionStopButton.style.display = "none";
                cameraActionStartButton.style.display = "inline-block";
                if (torchButton) {
                    torchButton.reset();
                    torchButton.hide();
                }
                cameraZoomUi.removeOnCameraZoomValueChangeCallback();
                cameraZoomUi.hide();
                $this.insertCameraScanImageToScanRegion();
            }).catch((error) => {
                cameraActionStopButton.disabled = false;
                $this.setHeaderMessage(error, Html5QrcodeScannerStatus.STATUS_WARNING);
            });
        });
        if ($this.persistedDataManager.getLastUsedCameraId()) {
            const cameraId = $this.persistedDataManager.getLastUsedCameraId();
            if (cameraSelectUi.hasValue(cameraId)) {
                cameraSelectUi.setValue(cameraId);
                cameraActionStartButton.click();
            }
            else {
                $this.persistedDataManager.resetLastUsedCameraId();
            }
        }
    }
    createSectionSwap() {
        const $this = this;
        const TEXT_IF_CAMERA_SCAN_SELECTED = Html5QrcodeScannerStrings.textIfCameraScanSelected();
        const TEXT_IF_FILE_SCAN_SELECTED = Html5QrcodeScannerStrings.textIfFileScanSelected();
        const switchContainer = document.createElement("div");
        switchContainer.style.textAlign = "center";
        this.switchScanTypeLink
            = BaseUiElementFactory.createElement("span", this.getDashboardSectionSwapLinkId());
        this.switchScanTypeLink.style.textDecoration = "underline";
        this.switchScanTypeLink.style.cursor = "pointer";
        this.switchScanTypeLink.innerText
            = ScanTypeSelector.isCameraScanType(this.currentScanType)
                ? TEXT_IF_CAMERA_SCAN_SELECTED : TEXT_IF_FILE_SCAN_SELECTED;
        this.switchScanTypeLink.addEventListener("click", function () {
            if (!$this.sectionSwapAllowed) {
                if ($this.verbose) {
                    $this.logger.logError("Section swap called when not allowed");
                }
                return;
            }
            $this.resetHeaderMessage();
            $this.fileSelectionUi.resetValue();
            $this.sectionSwapAllowed = false;
            if (ScanTypeSelector.isCameraScanType($this.currentScanType)) {
                $this.clearScanRegion();
                $this.scpCameraScanRegion.style.display = "none";
                $this.fileSelectionUi.show();
                $this.switchScanTypeLink.innerText = TEXT_IF_FILE_SCAN_SELECTED;
                $this.currentScanType = Html5QrcodeScanType.SCAN_TYPE_FILE;
                $this.insertFileScanImageToScanRegion();
            }
            else {
                $this.clearScanRegion();
                $this.scpCameraScanRegion.style.display = "block";
                $this.fileSelectionUi.hide();
                $this.switchScanTypeLink.innerText = TEXT_IF_CAMERA_SCAN_SELECTED;
                $this.currentScanType = Html5QrcodeScanType.SCAN_TYPE_CAMERA;
                $this.insertCameraScanImageToScanRegion();
                $this.startCameraScanIfPermissionExistsOnSwap();
            }
            $this.sectionSwapAllowed = true;
        });
        switchContainer.appendChild(this.switchScanTypeLink);
        this.dashboardSection.appendChild(switchContainer);
    }
    startCameraScanIfPermissionExistsOnSwap() {
        const $this = this;
        if (this.persistedDataManager.hasCameraPermissions()) {
            CameraPermissions.hasPermissions().then((hasPermissions) => {
                if (hasPermissions) {
                    if (!this.permissionButton) {
                        this.logger.logError("Permission button not found, fail;");
                        throw "Permission button not found";
                    }
                    this.permissionButton.click();
                }
                else {
                    $this.persistedDataManager.setHasPermission(false);
                }
            }).catch((_) => {
                $this.persistedDataManager.setHasPermission(false);
            });
            return;
        }
    }
    resetHeaderMessage() {
        this.headerMessageContainer.style.display = "none";
    }
    setHeaderMessage(messageText, scannerStatus) {
        if (!scannerStatus) {
            scannerStatus = Html5QrcodeScannerStatus.STATUS_DEFAULT;
        }
        this.headerMessageContainer.innerText = messageText;
        this.headerMessageContainer.style.display = "block";
        switch (scannerStatus) {
            case Html5QrcodeScannerStatus.STATUS_SUCCESS:
                this.headerMessageContainer.style.background = "rgba(106, 175, 80, 0.26)";
                this.headerMessageContainer.style.color = "#477735";
                break;
            case Html5QrcodeScannerStatus.STATUS_WARNING:
                this.headerMessageContainer.style.background = "rgba(203, 36, 49, 0.14)";
                this.headerMessageContainer.style.color = "#cb2431";
                break;
            case Html5QrcodeScannerStatus.STATUS_DEFAULT:
            default:
                this.headerMessageContainer.style.background = "rgba(0, 0, 0, 0)";
                this.headerMessageContainer.style.color = "rgb(17, 17, 17)";
                break;
        }
    }
    showHideScanTypeSwapLink(shouldDisplay) {
        if (this.scanTypeSelector.hasMoreThanOneScanType()) {
            if (shouldDisplay !== true) {
                shouldDisplay = false;
            }
            this.sectionSwapAllowed = shouldDisplay;
            this.switchScanTypeLink.style.display
                = shouldDisplay ? "inline-block" : "none";
        }
    }
    insertCameraScanImageToScanRegion() {
        const $this = this;
        if (this.cameraScanImage) {
            this.qrCodeScanRegion.innerHTML = "<br>";
            this.qrCodeScanRegion.appendChild(this.cameraScanImage);
            return;
        }
        this.cameraScanImage = new Image;
        this.cameraScanImage.onload = (_) => {
            this.qrCodeScanRegion.innerHTML = "<br>";
            this.qrCodeScanRegion.appendChild($this.cameraScanImage);
        };
        this.cameraScanImage.width = 64;
        this.cameraScanImage.style.opacity = "0.8";
        this.cameraScanImage.src = ASSET_CAMERA_SCAN;
        this.cameraScanImage.alt = Html5QrcodeScannerStrings.cameraScanAltText();
    }
    insertFileScanImageToScanRegion() {
        const $this = this;
        if (this.fileScanImage) {
            this.qrCodeScanRegion.innerHTML = "<br>";
            this.qrCodeScanRegion.appendChild(this.fileScanImage);
            return;
        }
        this.fileScanImage = new Image;
        this.fileScanImage.onload = (_) => {
            this.qrCodeScanRegion.innerHTML = "<br>";
            this.qrCodeScanRegion.appendChild($this.fileScanImage);
        };
        this.fileScanImage.width = 64;
        this.fileScanImage.style.opacity = "0.8";
        this.fileScanImage.src = ASSET_FILE_SCAN;
        this.fileScanImage.alt = Html5QrcodeScannerStrings.fileScanAltText();
    }
    clearScanRegion() {
        this.qrCodeScanRegion.innerHTML = "";
    }
    getDashboardSectionId() {
        return "scanner__dashboard_section";
    }
    getDashboardSectionCameraScanRegionId() {
        return "scanner__dashboard_section_csr";
    }
    getDashboardSectionSwapLinkId() {
        return PublicUiElementIdAndClasses.SCAN_TYPE_CHANGE_ANCHOR_ID;
    }
    getScanRegionId() {
        return "scanner__scan_region";
    }
    getDashboardId() {
        return "scanner__dashboard";
    }
    getHeaderMessageContainerId() {
        return "scanner__header_message";
    }
    getCameraPermissionButtonId() {
        return PublicUiElementIdAndClasses.CAMERA_PERMISSION_BUTTON_ID;
    }
}
//# sourceMappingURL=html5-qrcode-scanner.js.map