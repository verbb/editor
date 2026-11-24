# Uploads

Photos and files go in a tray under the text, so they never break up what's written. Each one shows its progress, and the tray is where you add alt text, retry a failed upload or remove a file.

## Adding Files

Use the buttons under this reply to add a sample photo or file, or drop your own anywhere on the editor. You can also paste an image, or use the **Attach files** tool, which reads **Add photos** when the context only takes images.

When pasting from Office apps, which put a picture of your selection on the clipboard beside the text, the text is pasted and the picture is ignored.

<EditorDemo scenario="comment" files json />

Once a photo has uploaded, its **ALT** button asks what's in the photo. That description is saved with the document and used when your plugin renders it.

**What gets saved** lists the uploads after the text, as references to Craft Assets. Removing one from the tray only takes it out of this document and never deletes the Asset. Uploads become permanent when your plugin saves the document, as [Uploads](../developers/craft-integration.md#uploads) explains.

## Files That Aren't Allowed

The context decides which file types are allowed, how big they can be and how many a document can hold. Editor checks all three before anything is sent, so a file that would be refused is turned away before it uploads, with the reason. This demo allows four photos and three files of up to 10 MB. Try adding a fifth photo.

Some files are never accepted, whatever the context allows. SVG, HTML, XML, scripts and programs are refused because a browser could run them from where uploads are stored, and so is any file whose contents aren't what its name says, such as a page named like a photo. TIFF images are refused too.

## Where a Photo Was Taken

Photos lose their metadata before they're stored, including where they were taken, the camera's details and any hidden text. Editor removes it without re-encoding the image, so quality isn't lost, and first turns a phone photo the way it was taken, since that's recorded in the metadata too.

HEIC and AVIF photos can only have their metadata removed with ImageMagick, so they're accepted only when the server has PHP's Imagick extension. Without it they're refused with a message saying why.

## When an Upload Fails

Uploads to this reply are set to fail. Add a photo to see what happens.

<EditorDemo scenario="comment" files upload-fail />

The failed file stays in the tray with **Retry** and **Remove**. While any upload is still going or has failed, the editor won't post and says why, so a reply never goes out without the photo someone meant to include.
